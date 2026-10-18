/**
 * app/api/mission-control/telemetry/route.js
 *
 * GET /api/mission-control/telemetry
 *
 * Aggregates live operational telemetry for the Admin Mission Control dashboard.
 * Returns a composite payload including:
 *   - Live queue counts and SLA status per zone
 *   - Ward bed occupancy matrix (by ward type)
 *   - Active staff headcount by ward
 *   - Billing claims risk summary
 *   - Composite operational health score (0–100)
 *   - Doctor-to-patient ratio
 *
 * Access: ADMIN only (§164.312 minimum necessary)
 * Caching: 15-second Next.js unstable_cache with Pusher invalidation
 */

import { NextResponse } from 'next/server';
import { withHipaaAudit } from '@/lib/middleware/hipaaAuditHook';
import { withRLSContext } from '@/lib/rlsContext';
import { evaluateSla, getDispatchRecommendations } from '@/lib/services/SlaMonitorService';
import { revalidateTag } from 'next/cache';

export const dynamic = 'force-dynamic'; // Never cache at the edge — telemetry must be live

export const GET = withHipaaAudit('TELEMETRY_READ', ['ADMIN'], async (request, session) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const data = await withRLSContext(session, async (tx) => {

      // ── 1. Live Queue Snapshot ──────────────────────────────────────────────
      const liveVisits = await tx.visit.findMany({
        where: { status: { in: ['WAITING', 'CONSULTING'] } },
        include: {
          patient: { select: { id: true, name: true, bloodGroup: true } },
          doctor:  { select: { id: true, name: true, specialization: true, department: true } },
          clinicalNote: { select: { pharmacyStatus: true, createdAt: true, medications: true } },
          billingClaim: { select: { status: true, paymentStatus: true, createdAt: true, amount: true } },
        },
        orderBy: { queuePosition: 'asc' },
      });

      // ── 2. Ward Bed Matrix ──────────────────────────────────────────────────
      const allBeds = await tx.wardBed.findMany({
        select: {
          id: true, name: true, wardType: true, status: true,
          ventilator: true, patientId: true,
        },
        orderBy: { name: 'asc' },
      });

      const bedsByWard = allBeds.reduce((acc, bed) => {
        const ward = bed.wardType;
        if (!acc[ward]) acc[ward] = { total: 0, available: 0, occupied: 0, maintenance: 0, reserved: 0, ventilators: 0 };
        acc[ward].total += 1;
        acc[ward][bed.status.toLowerCase()] = (acc[ward][bed.status.toLowerCase()] || 0) + 1;
        if (bed.ventilator) acc[ward].ventilators += 1;
        return acc;
      }, {});

      const totalBeds = allBeds.length;
      const occupiedBeds = allBeds.filter((b) => b.status === 'OCCUPIED').length;
      const bedSaturationPct = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

      // ── 3. Today's Completed Consultations & Revenue ────────────────────────
      const completedToday = await tx.visit.count({
        where: { status: 'COMPLETED', completedAt: { gte: today } },
      });

      const paidRevenueAgg = await tx.billingClaim.aggregate({
        where: { paymentStatus: 'PAID', createdAt: { gte: today } },
        _sum: { amount: true },
      });
      const revenueToday = paidRevenueAgg._sum.amount || 0;

      // ── 4. Flagged Claims Summary ───────────────────────────────────────────
      const flaggedClaimsCount = await tx.billingClaim.count({ where: { status: 'FLAGGED' } });
      const criticalClaimsCount = await tx.billingClaim.count({
        where: { status: 'FLAGGED', rejectionRisk: { gte: 70 } },
      });

      // ── 5. Active Staff On-Duty Headcount (today's shifts) ─────────────────
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const activeShifts = await tx.staffShift.findMany({
        where: {
          status: { in: ['ON_DUTY', 'SCHEDULED'] },
          shiftStart: { gte: today },
          shiftEnd:   { lte: todayEnd },
        },
        include: { staff: { select: { name: true, role: true, department: true } } },
      });

      const staffByWard = activeShifts.reduce((acc, shift) => {
        const ward = shift.ward;
        if (!acc[ward]) acc[ward] = 0;
        acc[ward] += 1;
        return acc;
      }, {});

      const onDutyDoctors = activeShifts.filter((s) => s.staff?.role === 'DOCTOR').length;

      // ── 6. Doctor-to-Patient Ratio ─────────────────────────────────────────
      const activePatientCount = liveVisits.length;
      const doctorPatientRatio = onDutyDoctors > 0
        ? Math.round((activePatientCount / onDutyDoctors) * 10) / 10
        : null; // null = no doctors on duty

      // ── 7. SLA Analysis ────────────────────────────────────────────────────
      // Reshape visits into the format SlaMonitorService expects
      const queueForSla = liveVisits.map((v) => ({
        visitId:       v.id,
        patientId:     v.patient?.id,
        patientName:   v.patient?.name || 'Unknown',
        status:        v.status,
        queuePosition: v.queuePosition,
        doctorId:      v.doctorId,
        doctorName:    v.doctor?.name || '',
        checkInAt:     v.checkInAt,
        consultedAt:   v.consultedAt,
        vitals:        v.vitals,
        pharmacyStatus: v.clinicalNote?.pharmacyStatus || null,
      }));

      const clinicalNotes = liveVisits
        .filter((v) => v.clinicalNote)
        .map((v) => ({ visitId: v.id, ...v.clinicalNote }));

      const billingClaims = liveVisits
        .filter((v) => v.billingClaim)
        .map((v) => ({ visitId: v.id, ...v.billingClaim }));

      const slaReport = evaluateSla(queueForSla, clinicalNotes, billingClaims);
      const dispatchRecommendations = getDispatchRecommendations(slaReport);

      // ── 8. Composite Operational Health Score ──────────────────────────────
      // Weighted: SLA (40%) + Bed Saturation (30%) + Doctor Ratio (20%) + Billing Risk (10%)
      const slaPct   = slaReport.overallSlaScore;                                    // 0–100
      const bedScore = Math.max(0, 100 - bedSaturationPct);                          // invert: 100% occupancy = 0 score
      const ratioScore = doctorPatientRatio === null ? 80 :                          // no data → neutral
        Math.max(0, Math.min(100, 100 - (doctorPatientRatio - 1) * 10));             // ratio 1 = 100, ratio 11 = 0
      const billingScore = Math.max(0, 100 - (flaggedClaimsCount * 5));              // each flagged claim = -5

      const operationalHealthScore = Math.round(
        slaPct    * 0.40 +
        bedScore  * 0.30 +
        ratioScore * 0.20 +
        billingScore * 0.10
      );

      // ── 9. No-show count today ─────────────────────────────────────────────
      const noShowToday = await tx.visit.count({
        where: { status: 'NO_SHOW', checkInAt: { gte: today } },
      });

      return {
        // Live queue
        activePatientCount,
        consultationsCompletedToday: completedToday,
        noShowToday,

        // Bed matrix
        bedsByWard,
        totalBeds,
        occupiedBeds,
        bedSaturationPct,

        // Financial
        revenueProtected: revenueToday,
        flaggedClaims:    flaggedClaimsCount,
        criticalClaims:   criticalClaimsCount,

        // Staff
        staffByWard,
        onDutyDoctors,
        doctorPatientRatio,

        // SLA
        sla: slaReport,
        dispatchRecommendations,

        // Composite
        operationalHealthScore: Math.max(0, Math.min(100, operationalHealthScore)),

        // Meta
        computedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/mission-control/telemetry error:', error);
    return NextResponse.json(
      { error: 'Failed to compute operational telemetry' },
      { status: 500 }
    );
  }
});

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withRoleGuard, withAuth } from '@/lib/withRoleGuard';
import { withRLSContext } from '@/lib/rlsContext';
import { logAudit } from '@/lib/audit';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';

// ─── GET /api/vitals ─────────────────────────────────────────────────────────
// Fetch vital log history for a patient.
//  - Patients: own logs only (patientId from session, ignores query param)
//  - Doctors:  assigned patients' logs (consent-gated at DB layer via RLS)
//  - Nurses/Admin: cannot read clinical vitals (minimum necessary)
export const GET = withAuth(async (request, session) => {
  const userRole = (session.user.role || '').toUpperCase();

  // Block Admin from reading clinical vitals (HIPAA minimum necessary)
  if (['ADMIN', 'CASHIER', 'PHARMACIST'].includes(userRole)) {
    return NextResponse.json(
      { error: 'Forbidden: Administrative roles cannot access clinical vital logs.' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const from = searchParams.get('from'); // ISO date filter
    const to   = searchParams.get('to');

    // Always resolve patientId from session for Patients to prevent IDOR
    let patientId;
    if (userRole === 'PATIENT') {
      patientId = session.user.patientId;
      if (!patientId) {
        return NextResponse.json({ error: 'No patient profile linked to this account.' }, { status: 400 });
      }
    } else {
      // Doctors must supply a patientId — validated by RLS against consent
      patientId = searchParams.get('patientId');
      if (!patientId) {
        return NextResponse.json({ error: 'patientId query parameter is required.' }, { status: 400 });
      }
    }

    const vitals = await withRLSContext(session, (tx) =>
      tx.vitalLog.findMany({
        where: {
          patientId,
          ...(from || to
            ? {
                measuredAt: {
                  ...(from && { gte: new Date(from) }),
                  ...(to   && { lte: new Date(to) }),
                },
              }
            : {}),
        },
        orderBy: { measuredAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id:           true,
          patientId:    true,
          measuredAt:   true,
          bp_systolic:  true,
          bp_diastolic: true,
          heartRate:    true,
          glucose:      true,
          weight:       true,
          spo2:         true,
          temperature:  true,
          notes:        true,
          source:       true,
          createdAt:    true,
        },
      })
    );

    return NextResponse.json({
      data: vitals,
      meta: { count: vitals.length, offset, limit, patientId },
    });
  } catch (error) {
    console.error('GET /api/vitals error:', error);
    return NextResponse.json({ error: 'Failed to fetch vital logs' }, { status: 500 });
  }
});

// ─── POST /api/vitals ────────────────────────────────────────────────────────
// Log a new vital measurement.
//  - Patients: log their own vitals (patientId from session, source: SELF)
//  - Nurses:   log vitals for any patient (source: NURSE)
//  - Doctors:  CANNOT create vital logs (read-only access per security policy)
export const POST = withRoleGuard(['PATIENT', 'NURSE'], async (request, session) => {
  // Rate limit vital logging: 20 per minute per user (prevents abuse / data flooding)
  const rl = checkRateLimit(request, { limit: 20, windowMs: 60_000, prefix: 'vitals-post' });
  if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

  try {
    const userRole = (session.user.role || '').toUpperCase();
    const body = await request.json();

    let patientId;
    if (userRole === 'PATIENT') {
      // Patients can only log their own vitals — ignore any body.patientId
      patientId = session.user.patientId;
      if (!patientId) {
        return NextResponse.json({ error: 'No patient profile linked to this account.' }, { status: 400 });
      }
    } else {
      // Nurse specifies the patientId for the patient being assessed
      patientId = body.patientId;
      if (!patientId) {
        return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
      }
    }

    const {
      bp_systolic,
      bp_diastolic,
      heartRate,
      glucose,
      weight,
      spo2,
      temperature,
      notes,
    } = body;

    // Validate at least one measurement is present
    const hasMeasurement = [bp_systolic, bp_diastolic, heartRate, glucose, weight, spo2, temperature]
      .some((v) => v !== undefined && v !== null);

    if (!hasMeasurement) {
      return NextResponse.json(
        { error: 'At least one vital measurement is required.' },
        { status: 400 }
      );
    }

    // Numeric range validation (clinical safety guardrails)
    if (heartRate     && (heartRate < 20     || heartRate > 300))    return NextResponse.json({ error: 'Heart rate out of valid range (20–300 bpm)' }, { status: 422 });
    if (spo2          && (spo2 < 50          || spo2 > 100))         return NextResponse.json({ error: 'SpO2 out of valid range (50–100%)' }, { status: 422 });
    if (bp_systolic   && (bp_systolic < 50   || bp_systolic > 300))  return NextResponse.json({ error: 'Systolic BP out of valid range (50–300 mmHg)' }, { status: 422 });
    if (bp_diastolic  && (bp_diastolic < 20  || bp_diastolic > 200)) return NextResponse.json({ error: 'Diastolic BP out of valid range (20–200 mmHg)' }, { status: 422 });
    if (temperature   && (temperature < 30   || temperature > 45))   return NextResponse.json({ error: 'Temperature out of valid range (30–45°C)' }, { status: 422 });
    if (glucose       && (glucose < 1        || glucose > 1000))      return NextResponse.json({ error: 'Glucose out of valid range (1–1000 mg/dL)' }, { status: 422 });

    const vitalLog = await withRLSContext(session, (tx) =>
      tx.vitalLog.create({
        data: {
          patientId,
          recordedBy:   session.user.id,
          // measuredAt uses @default(now()) — server-authoritative timestamp
          bp_systolic:  bp_systolic  !== undefined ? parseInt(bp_systolic)  : null,
          bp_diastolic: bp_diastolic !== undefined ? parseInt(bp_diastolic) : null,
          heartRate:    heartRate    !== undefined ? parseInt(heartRate)    : null,
          glucose:      glucose      !== undefined ? parseFloat(glucose)    : null,
          weight:       weight       !== undefined ? parseFloat(weight)     : null,
          spo2:         spo2         !== undefined ? parseInt(spo2)         : null,
          temperature:  temperature  !== undefined ? parseFloat(temperature): null,
          notes:        notes || null,
          source:       userRole === 'NURSE' ? 'NURSE' : 'SELF',
        },
      })
    );

    await logAudit(
      session.user.id,
      session.user.name || 'Unknown',
      userRole,
      'VITAL_LOG_CREATED',
      patientId,
      {
        vitalLogId: vitalLog.id,
        source: vitalLog.source,
        measuredAt: vitalLog.measuredAt,
      }
    ).catch(console.error);

    return NextResponse.json(vitalLog, { status: 201 });
  } catch (error) {
    console.error('POST /api/vitals error:', error);
    return NextResponse.json({ error: 'Failed to create vital log' }, { status: 500 });
  }
});

// ─── DELETE /api/vitals?id=... ───────────────────────────────────────────────
// Patients can delete their own vital logs.
// Doctors and Admin CANNOT delete vital logs.
export const DELETE = withRoleGuard(['PATIENT'], async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    // Verify the record belongs to this patient before deleting
    const existing = await prisma.vitalLog.findUnique({
      where: { id },
      select: { patientId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Vital log not found' }, { status: 404 });
    }

    if (existing.patientId !== session.user.patientId) {
      await logAudit(
        session.user.id, session.user.name || 'Unknown', 'PATIENT',
        'UNAUTHORIZED_VITAL_DELETE_ATTEMPT', existing.patientId,
        { attemptedId: id }
      ).catch(console.error);
      return NextResponse.json({ error: 'Forbidden: Cannot delete another patient\'s vital log.' }, { status: 403 });
    }

    await withRLSContext(session, (tx) =>
      tx.vitalLog.delete({ where: { id } })
    );

    await logAudit(
      session.user.id, session.user.name || 'Unknown', 'PATIENT',
      'VITAL_LOG_DELETED', existing.patientId, { deletedId: id }
    ).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/vitals error:', error);
    return NextResponse.json({ error: 'Failed to delete vital log' }, { status: 500 });
  }
});

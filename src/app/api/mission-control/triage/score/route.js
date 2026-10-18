/**
 * app/api/mission-control/triage/score/route.js
 *
 * POST /api/mission-control/triage/score
 *
 * Computes a deterministic clinical acuity score for a patient
 * and optionally updates their Visit record with the result.
 *
 * Request Body:
 *   {
 *     visitId?:      string   - If provided, persists isCritical flag to Visit
 *     vitals:        object   - Vital signs payload (see AcuityService for fields)
 *     chiefComplaint?: string - Patient's chief complaint text
 *     autoAllocate?:  boolean - If true, suggests the best available bed
 *   }
 *
 * Response:
 *   {
 *     score:                   number
 *     classification:          string
 *     wardRecommendation:      string
 *     bedTypeRecommendation:   string     - Maps to WardBed.wardType enum
 *     triggers:                string[]
 *     requiresImmediateAttention: boolean
 *     suggestedBed?:           object     - Best available bed if autoAllocate=true
 *     visitUpdated?:           boolean
 *   }
 *
 * Access: ADMIN, NURSE, DOCTOR
 */

import { NextResponse } from 'next/server';
import { withHipaaAudit } from '@/lib/middleware/hipaaAuditHook';
import { calculateAcuityScore, recommendationToBedType } from '@/lib/services/AcuityService';
import prisma from '@/lib/prisma';
import { withRLSContext } from '@/lib/rlsContext';

// ── Vitals input validation ───────────────────────────────────────────────────
function validateVitals(vitals) {
  if (!vitals || typeof vitals !== 'object') {
    return ['vitals must be a non-null object'];
  }

  const errors = [];
  const { bp, sbp, hr, heartRate, rr, respiratoryRate, spo2, spO2, gcs, temp, temperature } = vitals;

  // At least one vital must be present
  const hasAny = [bp, sbp, hr, heartRate, rr, respiratoryRate, spo2, spO2, gcs, temp, temperature]
    .some((v) => v !== undefined && v !== null && v !== '');
  if (!hasAny) {
    errors.push('At least one vital sign must be provided');
  }

  // Numeric range guards
  const checkRange = (value, label, min, max) => {
    if (value !== undefined && value !== null && value !== '') {
      const n = parseFloat(value);
      if (isNaN(n)) errors.push(`${label} must be a number`);
      else if (n < min || n > max) errors.push(`${label} must be between ${min} and ${max}`);
    }
  };

  if (bp && typeof bp === 'string' && bp.includes('/')) {
    const parts = bp.split('/');
    checkRange(parts[0], 'Systolic BP',  40, 300);
    checkRange(parts[1], 'Diastolic BP', 20, 200);
  }
  if (sbp !== undefined) checkRange(sbp, 'Systolic BP', 40, 300);
  checkRange(hr ?? heartRate,           'Heart Rate', 10, 300);
  checkRange(rr ?? respiratoryRate,     'Respiratory Rate', 1, 80);
  checkRange(spo2 ?? spO2,             'SpO2', 0, 100);
  checkRange(gcs,                       'GCS', 3, 15);
  checkRange(temp ?? temperature,       'Temperature', 25, 45);

  return errors;
}

export const POST = withHipaaAudit(
  'TRIAGE_SCORE_COMPUTED',
  ['ADMIN', 'NURSE', 'DOCTOR'],
  async (request, session) => {
    try {
      const body = await request.json();
      const { visitId, vitals, chiefComplaint = '', autoAllocate = false } = body;

      // ── Input Validation ────────────────────────────────────────────────────
      const vitalsErrors = validateVitals(vitals);
      if (vitalsErrors.length > 0) {
        return NextResponse.json(
          { error: 'Vitals validation failed', details: vitalsErrors },
          { status: 422 }
        );
      }

      if (chiefComplaint && typeof chiefComplaint !== 'string') {
        return NextResponse.json({ error: 'chiefComplaint must be a string' }, { status: 422 });
      }

      // ── Compute Acuity Score ─────────────────────────────────────────────────
      const acuityResult = calculateAcuityScore(vitals, chiefComplaint);
      const bedTypeRecommendation = recommendationToBedType(acuityResult.wardRecommendation);

      let visitUpdated = false;
      let suggestedBed = null;

      await withRLSContext(session, async (tx) => {

        // ── Optionally update the Visit with isCritical flag ───────────────────
        if (visitId && typeof visitId === 'string') {
          const visit = await tx.visit.findUnique({ where: { id: visitId } });
          if (visit) {
            await tx.visit.update({
              where: { id: visitId },
              data: {
                isCritical: acuityResult.requiresImmediateAttention,
                // Merge new vitals into existing vitals JSON (patch, not overwrite)
                vitals: {
                  ...(typeof visit.vitals === 'object' && visit.vitals !== null ? visit.vitals : {}),
                  ...vitals,
                },
              },
            });
            visitUpdated = true;
          }
        }

        // ── Optionally find best matching available bed ─────────────────────────
        if (autoAllocate) {
          // Priority: exact ward match first, then any AVAILABLE bed
          const exactMatch = await tx.wardBed.findFirst({
            where: {
              status: 'AVAILABLE',
              wardType: bedTypeRecommendation,
            },
            include: {
              patient: { select: { id: true, name: true } },
            },
            orderBy: { name: 'asc' },
          });

          if (exactMatch) {
            suggestedBed = exactMatch;
          } else {
            // Fallback: find any available bed
            const fallback = await tx.wardBed.findFirst({
              where: { status: 'AVAILABLE' },
              include: { patient: { select: { id: true, name: true } } },
              orderBy: { name: 'asc' },
            });
            suggestedBed = fallback || null;
          }
        }
      });

      return NextResponse.json({
        score:                      acuityResult.score,
        classification:             acuityResult.classification,
        wardRecommendation:         acuityResult.wardRecommendation,
        bedTypeRecommendation,
        triggers:                   acuityResult.triggers,
        requiresImmediateAttention: acuityResult.requiresImmediateAttention,
        visitUpdated,
        suggestedBed: suggestedBed
          ? {
              id:       suggestedBed.id,
              name:     suggestedBed.name,
              wardType: suggestedBed.wardType,
              ventilator: suggestedBed.ventilator,
            }
          : null,
      });

    } catch (error) {
      console.error('POST /api/mission-control/triage/score error:', error);
      return NextResponse.json(
        { error: 'Failed to compute triage acuity score' },
        { status: 500 }
      );
    }
  }
);

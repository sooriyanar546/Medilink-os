import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/withRoleGuard';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';
import { compoundDailyFormula } from '@/lib/services/SupplementCabinetService';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

/**
 * POST /api/preventative/supplements/compound
 *
 * Dynamic Daily Micronutrient Formula Generator.
 *
 * Computes a personalized daily supplement formulation based on:
 *   - Current exposome state (AQI, UV Index, Pollen)
 *   - Current biometric state (HRV, Sleep, Stress)
 *   - Patient's active medications (drug-nutrient contraindication check)
 *   - Known allergies (allergen suppression)
 *
 * Safety Enforcement:
 *   - FAIL CLOSED: contraindicated compounds are suppressed with audit warning
 *   - Fat-soluble vitamin UL validation (D3, K2, A)
 *   - Dose reduction applied for MODERATE interactions
 *   - Full audit trail persisted to supplement_formulas table
 *
 * Body:
 *   exposomeState: { aqi, pm25, uvIndex, pollenMax }
 *   biometricState: { hrv, hrvBaseline, sleepHours, sleepBaseline, stressIndex, deepRemRatio }
 *   (activeMedications and knownAllergies are loaded from user_longevity_profiles)
 */
export const POST = withAuth(async (request, session) => {
  const rl = checkRateLimit(request, { limit: 10, windowMs: 60_000, prefix: 'supplements-compound' });
  if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

  const userRole = (session.user.role || '').toUpperCase();

  let patientId;
  if (userRole === 'PATIENT') {
    patientId = session.user.patientId;
    if (!patientId) return NextResponse.json({ error: 'No patient profile linked to this account.' }, { status: 400 });
  } else if (['DOCTOR', 'NURSE'].includes(userRole)) {
    const body = await request.clone().json().catch(() => ({}));
    patientId = body.patientId;
    if (!patientId) return NextResponse.json({ error: 'patientId is required.' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { exposomeState = {}, biometricState = {} } = body;

    // Load active medications and allergies from longevity profile
    const profileRows = await prisma.$queryRaw`
      SELECT active_medications, known_allergies
      FROM user_longevity_profiles
      WHERE patient_id = ${patientId}
      LIMIT 1
    `;

    const profile            = profileRows?.[0] || {};
    const activeMedications  = Array.isArray(profile.active_medications)
      ? profile.active_medications
      : (profile.active_medications ? JSON.parse(profile.active_medications) : []);
    const knownAllergies     = Array.isArray(profile.known_allergies)
      ? profile.known_allergies
      : (profile.known_allergies ? JSON.parse(profile.known_allergies) : []);

    // Run compounding engine
    const result = await compoundDailyFormula({
      patientId,
      activeMedications,
      knownAllergies,
      exposomeState,
      biometricState,
    });

    await logAudit(session.user.id, session.user.name || 'Unknown', userRole,
      'SUPPLEMENT_FORMULA_COMPOUNDED', patientId,
      {
        formulaCount:    result.formula.length,
        suppressedCount: result.suppressed.length,
        auditWarnings:   result.auditWarnings.length,
        activeTriggers:  result.activeTriggers,
      }
    ).catch(console.error);

    return NextResponse.json({
      formula:            result.formula,
      suppressed:         result.suppressed,
      auditWarnings:      result.auditWarnings,
      activeTriggers:     result.activeTriggers,
      contraindCheckedAt: result.contraindCheckedAt,
      formulaDate:        new Date().toISOString().split('T')[0],
      clinicalDisclaimer: 'This formulation is algorithmically generated for wellness optimization. Consult a registered dietitian or physician before initiating any supplementation protocol.',
    });

  } catch (error) {
    console.error('POST /api/preventative/supplements/compound error:', error);
    return NextResponse.json({ error: 'Supplement compounding failed.' }, { status: 500 });
  }
});

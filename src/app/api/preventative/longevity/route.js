import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/withRoleGuard';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';
import { simulateBiologicalAge, computeMAP, computeDeepRemRatio } from '@/lib/services/LongevitySimulatorService';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

/**
 * GET /api/preventative/longevity/simulate
 *
 * Live Digital Twin Biological Age Simulation.
 *
 * Resolves the patient's 30-day rolling biomarker averages from:
 *   1. user_longevity_profiles (pre-computed 30d averages)
 *   2. Falls back to last 30 days of vital_time_series if profile is stale
 *   3. Falls back to VitalLog (standard vitals) if time_series has no data
 *
 * Returns a full biological age simulation result including:
 *   - Biological Age, Aging Velocity, Bio-Age Delta
 *   - Organ Sub-scores (Cardiovascular, Metabolic, Autonomic, Neurological)
 *   - Longevity Tier, Aging Status
 *   - Positive and Risk factors
 *
 * Query params:
 *   - chronologicalAge: number (optional override; resolved from DoB if not provided)
 *   - heightCm: number (optional for BMI-based metabolic score)
 *
 * Role: PATIENT (own data only), DOCTOR (any patient with patientId param)
 */
export const GET = withAuth(async (request, session) => {
  const rl = checkRateLimit(request, { limit: 30, windowMs: 60_000, prefix: 'longevity-sim' });
  if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

  const userRole = (session.user.role || '').toUpperCase();
  const { searchParams } = new URL(request.url);

  // Resolve patient ID
  let patientId;
  if (userRole === 'PATIENT') {
    patientId = session.user.patientId;
    if (!patientId) return NextResponse.json({ error: 'No patient profile linked to this account.' }, { status: 400 });
  } else if (['DOCTOR', 'NURSE', 'ADMIN'].includes(userRole)) {
    patientId = searchParams.get('patientId');
    if (!patientId) return NextResponse.json({ error: 'patientId query parameter is required.' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Forbidden: Role not permitted to access longevity simulation.' }, { status: 403 });
  }

  const heightCm = searchParams.get('heightCm') ? parseFloat(searchParams.get('heightCm')) : null;

  try {
    // 1. Attempt to load pre-computed longevity profile
    const profileRows = await prisma.$queryRaw`
      SELECT
        ulp.*,
        p.dob
      FROM user_longevity_profiles ulp
      JOIN "Patient" p ON p.id = ulp.patient_id
      WHERE ulp.patient_id = ${patientId}
      LIMIT 1
    `;

    // 2. Load 30-day averages from vital_time_series if profile is absent/stale
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const vitalAverages = await prisma.$queryRaw`
      SELECT
        AVG(heart_rate)::float              AS avg_rhr,
        AVG(hrv_rmssd)::float               AS avg_hrv,
        AVG(sleep_hours)::float             AS avg_sleep,
        AVG(deep_sleep_min)::float          AS avg_deep_min,
        AVG(rem_sleep_min)::float           AS avg_rem_min,
        AVG(sleep_hours * 60)::float        AS avg_total_min,
        AVG(map_computed)::float            AS avg_map,
        AVG(glucose)::float                 AS avg_glucose,
        AVG(stress_index)::float            AS avg_stress,
        AVG(weight_kg)::float               AS avg_weight
      FROM vital_time_series
      WHERE patient_id = ${patientId}
        AND measured_at >= ${thirtyDaysAgo}
    `;

    // 3. Fallback: standard VitalLog table
    const standardVitals = await prisma.vitalLog.findMany({
      where: {
        patientId,
        measuredAt: { gte: thirtyDaysAgo },
      },
      select: { heartRate: true, glucose: true, weight: true, bp_systolic: true, bp_diastolic: true },
      orderBy: { measuredAt: 'desc' },
      take: 60,
    });

    // 4. Resolve Patient DOB for chronological age
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { dob: true, name: true },
    });

    const dobDate = patient?.dob ? new Date(patient.dob) : null;
    const chronologicalAge = dobDate
      ? parseFloat(((Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)).toFixed(2))
      : parseFloat(searchParams.get('chronologicalAge') || '35');

    // 5. Merge data sources
    const ts    = vitalAverages?.[0] || {};
    const vlAvg = standardVitals.length > 0 ? {
      rhr:     standardVitals.map(v => v.heartRate).filter(Boolean).reduce((a, b) => a + b, 0) / (standardVitals.filter(v => v.heartRate).length || 1),
      glucose: standardVitals.map(v => v.glucose).filter(Boolean).reduce((a, b) => a + b, 0) / (standardVitals.filter(v => v.glucose).length || 1),
      weight:  standardVitals.map(v => v.weight).filter(Boolean).reduce((a, b) => a + b, 0) / (standardVitals.filter(v => v.weight).length || 1),
      map:     standardVitals.filter(v => v.bp_systolic && v.bp_diastolic)
        .map(v => computeMAP(v.bp_systolic, v.bp_diastolic))
        .reduce((a, b) => a + b, 0) / (standardVitals.filter(v => v.bp_systolic && v.bp_diastolic).length || 1),
    } : {};

    const profile = profileRows?.[0] || {};

    const deepRemRatio = ts.avg_deep_min && ts.avg_rem_min && ts.avg_total_min
      ? computeDeepRemRatio({
          deepMin:  ts.avg_deep_min,
          remMin:   ts.avg_rem_min,
          totalMin: ts.avg_total_min,
        })
      : parseFloat(profile.avg_deep_rem_ratio_30d || '0.30');

    // 6. Run simulation
    const simulation = simulateBiologicalAge({
      chronologicalAge,
      avgRhr30d:         ts.avg_rhr        || vlAvg.rhr     || parseFloat(profile.avg_rhr_30d       || '65'),
      avgHrv30d:         ts.avg_hrv        || parseFloat(profile.avg_hrv_rmssd_30d || '45'),
      avgDeepRemRatio:   deepRemRatio,
      avgMap30d:         ts.avg_map        || vlAvg.map     || parseFloat(profile.avg_map_30d        || '90'),
      avgFastingGlucose: ts.avg_glucose    || vlAvg.glucose || parseFloat(profile.avg_fasting_glucose_30d || '90'),
      avgStressIndex:    ts.avg_stress     || parseFloat(profile.avg_stress_index_30d || '35'),
      weight:            ts.avg_weight     || vlAvg.weight  || null,
      heightCm,
    });

    // 7. Persist updated values to longevity profile
    await prisma.$executeRaw`
      INSERT INTO user_longevity_profiles (
        patient_id, date_of_birth, chronological_age,
        biological_age, aging_velocity, bio_age_delta,
        cardiovascular_score, metabolic_score, autonomic_score, neurological_score,
        avg_rhr_30d, avg_hrv_rmssd_30d, avg_deep_rem_ratio_30d,
        avg_map_30d, avg_fasting_glucose_30d, avg_stress_index_30d,
        last_computed_at, created_at, updated_at
      ) VALUES (
        ${patientId},
        ${patient?.dob || null}::date,
        ${chronologicalAge},
        ${simulation.biologicalAge},
        ${simulation.agingVelocity},
        ${simulation.bioAgeDelta},
        ${simulation.organSubScores.cardiovascular},
        ${simulation.organSubScores.metabolic},
        ${simulation.organSubScores.autonomic},
        ${simulation.organSubScores.neurological},
        ${ts.avg_rhr || null},
        ${ts.avg_hrv || null},
        ${deepRemRatio},
        ${ts.avg_map || null},
        ${ts.avg_glucose || null},
        ${ts.avg_stress || null},
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (patient_id)
      DO UPDATE SET
        chronological_age = EXCLUDED.chronological_age,
        biological_age = EXCLUDED.biological_age,
        aging_velocity = EXCLUDED.aging_velocity,
        bio_age_delta = EXCLUDED.bio_age_delta,
        cardiovascular_score = EXCLUDED.cardiovascular_score,
        metabolic_score = EXCLUDED.metabolic_score,
        autonomic_score = EXCLUDED.autonomic_score,
        neurological_score = EXCLUDED.neurological_score,
        avg_rhr_30d = COALESCE(EXCLUDED.avg_rhr_30d, user_longevity_profiles.avg_rhr_30d),
        avg_hrv_rmssd_30d = COALESCE(EXCLUDED.avg_hrv_rmssd_30d, user_longevity_profiles.avg_hrv_rmssd_30d),
        avg_deep_rem_ratio_30d = EXCLUDED.avg_deep_rem_ratio_30d,
        avg_map_30d = COALESCE(EXCLUDED.avg_map_30d, user_longevity_profiles.avg_map_30d),
        avg_fasting_glucose_30d = COALESCE(EXCLUDED.avg_fasting_glucose_30d, user_longevity_profiles.avg_fasting_glucose_30d),
        avg_stress_index_30d = COALESCE(EXCLUDED.avg_stress_index_30d, user_longevity_profiles.avg_stress_index_30d),
        last_computed_at = NOW(),
        updated_at = NOW()
    `;

    await logAudit(session.user.id, session.user.name || 'Unknown', userRole,
      'LONGEVITY_SIM_RUN', patientId, { biologicalAge: simulation.biologicalAge, agingVelocity: simulation.agingVelocity }
    ).catch(console.error);

    return NextResponse.json({
      patientId,
      patientName: patient?.name || null,
      chronologicalAge,
      simulation,
      dataQuality: {
        hasTimeSeriesData: (vitalAverages?.[0]?.avg_rhr !== null),
        hasStandardVitals: standardVitals.length > 0,
        hasLongevityProfile: profileRows?.length > 0,
        readingsCount30d: standardVitals.length,
      },
      computedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('GET /api/preventative/longevity/simulate error:', error);
    return NextResponse.json({ error: 'Longevity simulation failed.' }, { status: 500 });
  }
});

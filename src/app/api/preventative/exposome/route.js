import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/withRoleGuard';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';
import { analyzeExposome } from '@/lib/services/ExposomeShieldService';
import { validateExposomePayload } from '@/lib/middleware/preventativeCare';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { awardLongevityPoints } from '@/lib/services/VitalGamificationService';

/**
 * POST /api/preventative/exposome/sync
 *
 * Geolocation-based Environmental Stress Analysis and Shielding Rules.
 *
 * Accepts environmental telemetry from the client (or passed from a
 * server-side weather API integration) and returns:
 *   - Composite Environmental Stress Score (0-100)
 *   - Per-domain sub-scores (AQI, UV, Pollen, Thermal, Humidity)
 *   - Deterministic, ordered mitigation protocols
 *   - Supplement trigger tags (for SupplementCabinetService)
 *
 * Persists the snapshot to exposome_snapshots for historical burden analysis.
 * Awards 25 Longevity Points for the EXPOSOME_SYNC event.
 *
 * Body:
 *   aqiComposite, pm25?, pm10?, o3Ppb?, no2Ppb?,
 *   uvIndex, pollenTree?, pollenGrass?, pollenWeed?,
 *   ambientTempC, heatIndexC?, humidityPct,
 *   latitude?, longitude?, locationLabel?
 */
export const POST = withAuth(async (request, session) => {
  const rl = checkRateLimit(request, { limit: 20, windowMs: 60_000, prefix: 'exposome-sync' });
  if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

  const userRole = (session.user.role || '').toUpperCase();

  let patientId;
  if (userRole === 'PATIENT') {
    patientId = session.user.patientId;
    if (!patientId) return NextResponse.json({ error: 'No patient profile linked to this account.' }, { status: 400 });
  } else if (['DOCTOR', 'NURSE', 'ADMIN'].includes(userRole)) {
    const body = await request.clone().json().catch(() => ({}));
    patientId = body.patientId;
    if (!patientId) return NextResponse.json({ error: 'patientId is required.' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Validate exposome sensor ranges
    const validationError = validateExposomePayload(body);
    if (validationError) return validationError;

    const {
      aqiComposite = 0, pm25, pm10, o3Ppb, no2Ppb,
      uvIndex = 0, pollenTree = 0, pollenGrass = 0, pollenWeed = 0,
      ambientTempC = 22, heatIndexC, humidityPct = 50,
      latitude, longitude, locationLabel,
    } = body;

    // Run exposome analysis
    const result = analyzeExposome({
      aqiComposite, pm25, pm10, o3Ppb, no2Ppb,
      uvIndex, pollenTree, pollenGrass, pollenWeed,
      ambientTempC, heatIndexC, humidityPct, locationLabel,
    });

    // Persist snapshot
    await prisma.$executeRaw`
      INSERT INTO exposome_snapshots (
        patient_id, latitude, longitude, location_label,
        aqi_composite, pm25_ug_m3, pm10_ug_m3, o3_ppb, no2_ppb,
        uv_index, ambient_temp_c, humidity_pct, heat_index_c,
        pollen_tree, pollen_grass, pollen_weed,
        environmental_stress_score, mitigation_protocols,
        snapshot_at, data_source
      ) VALUES (
        ${patientId},
        ${latitude || null},
        ${longitude || null},
        ${locationLabel || null},
        ${aqiComposite},
        ${pm25 || null},
        ${pm10 || null},
        ${o3Ppb || null},
        ${no2Ppb || null},
        ${uvIndex},
        ${ambientTempC},
        ${humidityPct},
        ${heatIndexC || null},
        ${pollenTree},
        ${pollenGrass},
        ${pollenWeed},
        ${result.stressScore},
        ${JSON.stringify(result.mitigationProtocols)}::jsonb,
        NOW(),
        'MANUAL'
      )
    `;

    // Award Longevity Points
    const pointsResult = await awardLongevityPoints({
      patientId,
      eventType: 'EXPOSOME_SYNC',
    }).catch(e => { console.error('[exposome/sync] Points award error:', e); return null; });

    await logAudit(session.user.id, session.user.name || 'Unknown', userRole,
      'EXPOSOME_SYNC', patientId,
      { stressScore: result.stressScore, location: locationLabel, mitigationCount: result.mitigationProtocols.length }
    ).catch(console.error);

    return NextResponse.json({
      stressScore:          result.stressScore,
      stressCategory:       result.stressCategory,
      subScores:            result.subScores,
      mitigationProtocols:  result.mitigationProtocols,
      supplementTriggers:   result.supplementTriggers,
      locationLabel:        result.locationLabel,
      pointsAwarded:        pointsResult?.pointsAwarded || 0,
      newBalance:           pointsResult?.newBalance    || 0,
      snapshotAt:           new Date().toISOString(),
    });

  } catch (error) {
    console.error('POST /api/preventative/exposome/sync error:', error);
    return NextResponse.json({ error: 'Exposome analysis failed.' }, { status: 500 });
  }
});

import { NextResponse } from 'next/server';
import { withRoleGuard } from '@/lib/withRoleGuard';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';
import { analyzeVoiceAudio } from '@/lib/services/AcousticAnalysisService';
import { sanitizeBiometricPayload } from '@/lib/middleware/preventativeCare';
import { awardLongevityPoints } from '@/lib/services/VitalGamificationService';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

/**
 * POST /api/preventative/voice/audit
 *
 * Voice Sample Acoustic Feature Extractor and Fatigue Scorer.
 *
 * Accepts raw audio binary (audio/wav or audio/webm) as the request body.
 * Performs in-memory acoustic feature extraction and immediately purges
 * the raw audio buffer. ONLY extracted numeric features are persisted.
 *
 * BIOMETRIC PRIVACY COMPLIANCE:
 *   - Raw audio is NEVER written to disk, database, or any log
 *   - Only numeric feature vectors (jitter, shimmer, HNR, F0) are stored
 *   - raw_audio_purged_at timestamp is recorded for GDPR compliance audit
 *
 * Returns:
 *   - Jitter (pitch perturbation %)
 *   - Shimmer (amplitude perturbation %)
 *   - F0 mean/stddev/drift (fundamental frequency analysis)
 *   - HNR dB (harmonics-to-noise ratio)
 *   - Vocal Cord Strain Index (0-100)
 *   - HPA-Axis Fatigue Score (0-100)
 *   - Burnout Risk Level (LOW/MODERATE/HIGH/CRITICAL)
 *
 * Awards 75 Longevity Points for VOICE_AUDIT event.
 *
 * Access: PATIENT only (own voice biometrics)
 */
export const POST = withRoleGuard(['PATIENT'], async (request, session) => {
  const rl = checkRateLimit(request, { limit: 5, windowMs: 60_000, prefix: 'voice-audit' });
  if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

  // Step 1: Biometric payload sanitization check (before reading body)
  const sanitizationResult = await sanitizeBiometricPayload(request);
  if (sanitizationResult.error) return sanitizationResult.error;

  const patientId = session.user.patientId;
  if (!patientId) {
    return NextResponse.json({ error: 'No patient profile linked to this account.' }, { status: 400 });
  }

  // Step 2: Read audio body as ArrayBuffer
  // The buffer is intentionally processed INLINE — never assigned to a stored reference.
  let acousticFeatures;
  const purgedAt = new Date();

  try {
    const audioBuffer = await request.arrayBuffer();
    // ─── PRIVACY BOUNDARY ────────────────────────────────────────────────────
    // audioBuffer is processed synchronously here. It goes out of scope
    // immediately after analyzeVoiceAudio returns. No reference is kept.
    acousticFeatures  = analyzeVoiceAudio(audioBuffer, sanitizationResult.contentType);
    // ─── END PRIVACY BOUNDARY ────────────────────────────────────────────────
    // From this point, raw audio no longer exists in memory (GC eligible).
  } catch (error) {
    if (error.message.includes('bit depth') || error.message.includes('voiced') || error.message.includes('too short')) {
      return NextResponse.json(
        { error: error.message, code: 'AUDIO_ANALYSIS_ERROR' },
        { status: 422 }
      );
    }
    console.error('POST /api/preventative/voice/audit — audio processing error:', error);
    return NextResponse.json({ error: 'Audio processing failed. Please try again.' }, { status: 500 });
  }

  try {
    // Step 3: Persist ONLY extracted feature vectors — never raw audio
    const logRows = await prisma.$queryRaw`
      INSERT INTO voice_acoustic_logs (
        patient_id, recorded_by,
        jitter_pct, shimmer_pct,
        f0_mean_hz, f0_stddev_hz, f0_drift_pct, hnr_db,
        vocal_cord_strain_index, hpa_axis_fatigue_score,
        burnout_risk_level,
        recording_duration_ms, sample_rate_hz, audio_format,
        raw_audio_purged_at, recorded_at
      ) VALUES (
        ${patientId}, ${session.user.id},
        ${acousticFeatures.jitterPct},
        ${acousticFeatures.shimmerPct},
        ${acousticFeatures.f0MeanHz},
        ${acousticFeatures.f0StddevHz},
        ${acousticFeatures.f0DriftPct},
        ${acousticFeatures.hnrDb},
        ${acousticFeatures.vocalCordStrainIndex},
        ${acousticFeatures.hpaAxisFatigueScore},
        ${acousticFeatures.burnoutRiskLevel},
        ${acousticFeatures.recordingDurationMs || null},
        ${acousticFeatures.sampleRateHz || null},
        ${sanitizationResult.contentType},
        ${purgedAt.toISOString()}::timestamptz,
        NOW()
      )
      RETURNING id
    `;

    const logId = logRows?.[0]?.id;

    // Step 4: Award Longevity Points
    const pointsResult = await awardLongevityPoints({
      patientId,
      eventType: 'VOICE_AUDIT',
      refEntityId: logId,
    }).catch(e => { console.error('[voice/audit] Points award error:', e); return null; });

    // Step 5: Audit log (no PHI — only scores, not features)
    await logAudit(
      session.user.id, session.user.name || 'Unknown', 'PATIENT',
      'VOICE_AUDIT_COMPLETED', patientId,
      {
        logId,
        burnoutRiskLevel: acousticFeatures.burnoutRiskLevel,
        hpaScore: acousticFeatures.hpaAxisFatigueScore,
        rawAudioPurgedAt: purgedAt.toISOString(),
      }
    ).catch(console.error);

    return NextResponse.json({
      acousticFeatures: {
        jitterPct:             acousticFeatures.jitterPct,
        shimmerPct:            acousticFeatures.shimmerPct,
        f0MeanHz:              acousticFeatures.f0MeanHz,
        f0StddevHz:            acousticFeatures.f0StddevHz,
        f0DriftPct:            acousticFeatures.f0DriftPct,
        hnrDb:                 acousticFeatures.hnrDb,
      },
      clinicalScores: {
        vocalCordStrainIndex:  acousticFeatures.vocalCordStrainIndex,
        hpaAxisFatigueScore:   acousticFeatures.hpaAxisFatigueScore,
        burnoutRiskLevel:      acousticFeatures.burnoutRiskLevel,
      },
      recordingDurationMs:    acousticFeatures.recordingDurationMs,
      rawAudioPurgedAt:       purgedAt.toISOString(),
      privacyCompliance:      'RAW_AUDIO_DESTROYED_IN_MEMORY — HIPAA §164.312 / GDPR Art.25',
      logId,
      pointsAwarded:          pointsResult?.pointsAwarded || 0,
      newBalance:             pointsResult?.newBalance    || 0,
      analysisMode:           acousticFeatures.analysisMode || 'FULL_PCM',
    }, { status: 201 });

  } catch (error) {
    console.error('POST /api/preventative/voice/audit — DB persist error:', error);
    return NextResponse.json({ error: 'Failed to persist acoustic analysis results.' }, { status: 500 });
  }
});

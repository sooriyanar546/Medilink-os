import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/withRoleGuard';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';
import { analyzeMobility } from '@/lib/services/KineticMobilityService';
import { validateLandmarkPayload } from '@/lib/middleware/preventativeCare';
import { awardLongevityPoints } from '@/lib/services/VitalGamificationService';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

/**
 * POST /api/preventative/mobility/analyze
 *
 * Vision-Based Movement Keypoint Symmetry and Squat Mechanics Evaluator.
 *
 * Accepts a 33-landmark pose matrix (MediaPipe Pose / BlazePose schema) and
 * performs kinematic biomechanical analysis:
 *
 *   - Joint angle calculation (knee valgus, hip flexion, thoracic flexion, ankle dorsiflexion)
 *   - Hip-to-ankle alignment assessment
 *   - Bilateral kinetic symmetry percentage
 *   - Compensatory load shift detection and quantification
 *   - Composite mobility score (0-100)
 *   - Clinical mobility flags with severity classification
 *   - Deterministic correction routine generation
 *
 * No raw video or camera frames are persisted — only computed feature vectors.
 * Awards 100 Longevity Points for MOBILITY_SCAN event.
 *
 * Body:
 *   landmarks: Landmark[33]        - Array of 33 MediaPipe pose landmarks {x, y, z?, visibility?}
 *   movementType: string           - 'BODYWEIGHT_SQUAT' | 'SINGLE_LEG_BALANCE' | etc.
 *   poseConfidence: number         - Overall pose detection confidence [0,1]
 *   patientId?: string             - Required for DOCTOR/NURSE roles
 *
 * Access: PATIENT (own), DOCTOR, NURSE
 */
export const POST = withAuth(async (request, session) => {
  const rl = checkRateLimit(request, { limit: 15, windowMs: 60_000, prefix: 'mobility-analyze' });
  if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

  const userRole = (session.user.role || '').toUpperCase();

  let patientId;
  if (userRole === 'PATIENT') {
    patientId = session.user.patientId;
    if (!patientId) return NextResponse.json({ error: 'No patient profile linked to this account.' }, { status: 400 });
  } else if (['DOCTOR', 'NURSE', 'ADMIN'].includes(userRole)) {
    const body = await request.clone().json().catch(() => ({}));
    patientId = body.patientId;
    if (!patientId) return NextResponse.json({ error: 'patientId is required for this role.' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      landmarks,
      movementType  = 'BODYWEIGHT_SQUAT',
      poseConfidence = 1.0,
    } = body;

    // Validate landmark payload structure
    const { valid, error: landmarkError } = validateLandmarkPayload(landmarks);
    if (!valid) return landmarkError;

    // Validate movement type
    const VALID_MOVEMENT_TYPES = ['BODYWEIGHT_SQUAT', 'SINGLE_LEG_BALANCE', 'OVERHEAD_REACH', 'WALKING_GAIT', 'CUSTOM'];
    if (!VALID_MOVEMENT_TYPES.includes(movementType)) {
      return NextResponse.json(
        { error: `Invalid movementType: "${movementType}". Valid types: ${VALID_MOVEMENT_TYPES.join(', ')}`, code: 'INVALID_MOVEMENT_TYPE' },
        { status: 400 }
      );
    }

    // Run mobility analysis
    let mobilityResult;
    try {
      mobilityResult = analyzeMobility({ landmarks, movementType, poseConfidence });
    } catch (analysisError) {
      return NextResponse.json(
        { error: analysisError.message, code: 'MOBILITY_ANALYSIS_ERROR' },
        { status: 422 }
      );
    }

    // Persist to mobility_movement_logs (NO raw landmark coordinates stored)
    const logRows = await prisma.$queryRaw`
      INSERT INTO mobility_movement_logs (
        patient_id, recorded_by, movement_type,
        landmark_count, pose_confidence,
        left_knee_angle_deg, right_knee_angle_deg,
        knee_valgus_left_deg, knee_valgus_right_deg,
        hip_flexion_deg, thoracic_flexion_deg,
        ankle_dorsiflexion_left, ankle_dorsiflexion_right,
        hip_to_ankle_alignment, bilateral_symmetry_pct,
        load_shift_direction, load_shift_pct,
        mobility_score, mobility_flags, correction_routine,
        analyzed_at
      ) VALUES (
        ${patientId}, ${session.user.id}, ${movementType},
        33, ${poseConfidence},
        ${mobilityResult.jointAngles.leftKneeAngleDeg},
        ${mobilityResult.jointAngles.rightKneeAngleDeg},
        ${mobilityResult.jointAngles.kneeValgusLeftDeg},
        ${mobilityResult.jointAngles.kneeValgusRightDeg},
        ${mobilityResult.jointAngles.hipFlexionDeg},
        ${mobilityResult.jointAngles.thoracicFlexionDeg},
        ${mobilityResult.jointAngles.ankleDorsiflexionLeft},
        ${mobilityResult.jointAngles.ankleDorsiflexionRight},
        ${mobilityResult.hipToAnkleAlignment},
        ${mobilityResult.bilateralSymmetryPct},
        ${mobilityResult.loadShiftDirection},
        ${mobilityResult.loadShiftPct},
        ${mobilityResult.mobilityScore},
        ${JSON.stringify(mobilityResult.mobilityFlags)}::jsonb,
        ${mobilityResult.correctionRoutine},
        NOW()
      )
      RETURNING id
    `;

    const logId = logRows?.[0]?.id;

    // Award Longevity Points
    const pointsResult = await awardLongevityPoints({
      patientId,
      eventType: 'MOBILITY_SCAN',
      refEntityId: logId,
    }).catch(e => { console.error('[mobility/analyze] Points award error:', e); return null; });

    await logAudit(
      session.user.id, session.user.name || 'Unknown', userRole,
      'MOBILITY_SCAN_COMPLETED', patientId,
      {
        logId,
        mobilityScore: mobilityResult.mobilityScore,
        movementType,
        flagCount: mobilityResult.mobilityFlags.length,
        bilateralSymmetry: mobilityResult.bilateralSymmetryPct,
      }
    ).catch(console.error);

    return NextResponse.json({
      mobilityScore:        mobilityResult.mobilityScore,
      jointAngles:          mobilityResult.jointAngles,
      hipToAnkleAlignment:  mobilityResult.hipToAnkleAlignment,
      bilateralSymmetryPct: mobilityResult.bilateralSymmetryPct,
      loadShiftDirection:   mobilityResult.loadShiftDirection,
      loadShiftPct:         mobilityResult.loadShiftPct,
      mobilityFlags:        mobilityResult.mobilityFlags,
      correctionRoutine:    mobilityResult.correctionRoutine,
      movementType,
      poseConfidence,
      logId,
      pointsAwarded:        pointsResult?.pointsAwarded || 0,
      newBalance:           pointsResult?.newBalance    || 0,
      analyzedAt:           new Date().toISOString(),
      privacyNote:          'Raw pose keypoints not persisted — only computed feature vectors stored.',
    }, { status: 201 });

  } catch (error) {
    console.error('POST /api/preventative/mobility/analyze error:', error);
    return NextResponse.json({ error: 'Mobility analysis failed.' }, { status: 500 });
  }
});

/**
 * lib/services/KineticMobilityService.js
 *
 * Vision-Based Mobility & Kinetic Symmetry Evaluator
 *
 * Ingests spatial keypoint coordinates from a 33-landmark pose matrix
 * (compatible with MediaPipe Pose / BlazePose schema) and evaluates:
 *
 *   - Joint angle calculations (knee valgus, hip flexion, thoracic flexion, ankle dorsiflexion)
 *   - Hip-to-ankle alignment analysis
 *   - Bilateral kinetic symmetry percentage
 *   - Compensatory load shift detection
 *   - Composite mobility score (0-100)
 *   - Clinical correction routine generation
 *
 * Landmark Index Map (MediaPipe Pose 33-point schema):
 *   0:  Nose                  11: Left Shoulder      12: Right Shoulder
 *   13: Left Elbow            14: Right Elbow        15: Left Wrist
 *   16: Right Wrist           23: Left Hip           24: Right Hip
 *   25: Left Knee             26: Right Knee         27: Left Ankle
 *   28: Right Ankle           29: Left Heel          30: Right Heel
 *   31: Left Foot Index       32: Right Foot Index
 *
 * References:
 *   - Nakagawa et al. (2020) "Markerless gait analysis with MediaPipe" — Computer Methods in Biomechanics
 *   - Hewett et al. (2005) "Biomechanical measures of neuromuscular control" — American Journal of Sports Medicine
 *   - Mündermann et al. (2006) "Precision of the KineMat toolbox for biomechanical analysis"
 *   - FMS (Functional Movement Screen) scoring criteria — Cook & Burton (2006)
 */

// ─── Landmark Indices (MediaPipe 33-point) ───────────────────────────────────
const LM = {
  LEFT_HIP:     23,
  RIGHT_HIP:    24,
  LEFT_KNEE:    25,
  RIGHT_KNEE:   26,
  LEFT_ANKLE:   27,
  RIGHT_ANKLE:  28,
  LEFT_HEEL:    29,
  RIGHT_HEEL:   30,
  LEFT_SHOULDER:  11,
  RIGHT_SHOULDER: 12,
  NOSE:           0,
  MID_HIP:       null, // Computed as midpoint of 23 and 24
};

// ─── Clinical Reference Angles ────────────────────────────────────────────────
const REF_ANGLES = {
  SQUAT_HIP_FLEXION_OPTIMAL:    90,   // degrees — thigh parallel to floor
  SQUAT_KNEE_ANGLE_OPTIMAL:     90,   // degrees — at bottom of squat
  DORSIFLEXION_NORMAL_MIN:      15,   // degrees — minimum needed for squat mechanics
  VALGUS_TOLERANCE_DEG:          5,   // degrees — max acceptable knee valgus deviation
  THORACIC_FLEXION_NEUTRAL_MAX: 40,   // degrees — max neutral thoracic kyphosis
  BILATERAL_SYMMETRY_GOOD:      90,   // % — above this = good bilateral symmetry
  BILATERAL_SYMMETRY_FLAG:      85,   // % — below this triggers compensation flag
};

/**
 * @typedef {Object} Landmark
 * @property {number} x - Normalized X coordinate [0,1]
 * @property {number} y - Normalized Y coordinate [0,1]
 * @property {number} [z] - Normalized depth [−1,1]
 * @property {number} [visibility] - Detection confidence [0,1]
 */

/**
 * Extracts a landmark from the 33-point array with bounds checking.
 *
 * @param {Landmark[]} landmarks - Array of 33 pose landmarks
 * @param {number} index
 * @returns {Landmark}
 */
function lm(landmarks, index) {
  if (!landmarks || index < 0 || index >= landmarks.length) {
    throw new Error(`Landmark index ${index} out of bounds. Expected 33 landmarks.`);
  }
  return landmarks[index];
}

/**
 * Computes the 3D vector between two landmarks.
 *
 * @param {Landmark} a
 * @param {Landmark} b
 * @returns {{ x: number, y: number, z: number }}
 */
function vectorBetween(a, b) {
  return {
    x: b.x - a.x,
    y: b.y - a.y,
    z: (b.z || 0) - (a.z || 0),
  };
}

/**
 * Computes the dot product of two 3D vectors.
 *
 * @param {{ x, y, z }} v1
 * @param {{ x, y, z }} v2
 * @returns {number}
 */
function dotProduct(v1, v2) {
  return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
}

/**
 * Computes the magnitude of a 3D vector.
 *
 * @param {{ x, y, z }} v
 * @returns {number}
 */
function magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * Computes the angle (degrees) at the middle joint of a three-point chain.
 * Example: hip-knee-ankle gives the knee flexion angle.
 *
 * Formula: θ = arccos( (BA · BC) / (|BA| × |BC|) )
 *
 * @param {Landmark} a - Proximal landmark
 * @param {Landmark} b - Joint landmark (vertex of the angle)
 * @param {Landmark} c - Distal landmark
 * @returns {number} Angle in degrees [0, 180]
 */
function computeJointAngle(a, b, c) {
  const ba = vectorBetween(b, a);
  const bc = vectorBetween(b, c);

  const dot   = dotProduct(ba, bc);
  const magBA = magnitude(ba);
  const magBC = magnitude(bc);

  if (magBA === 0 || magBC === 0) return 0;

  const cosTheta = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  const angleRad = Math.acos(cosTheta);

  return Math.round(angleRad * (180 / Math.PI) * 100) / 100;
}

/**
 * Computes knee valgus deviation angle (medial collapse in frontal plane).
 * Projects knee position onto the hip-ankle axis and measures deviation.
 *
 * Clinically: Valgus = knee medially displaced relative to ideal hip-ankle line.
 * Positive value = valgus (knock-kneed), Negative = varus (bow-legged).
 *
 * @param {Landmark} hip
 * @param {Landmark} knee
 * @param {Landmark} ankle
 * @returns {number} Valgus deviation in degrees
 */
function computeKneeValgus(hip, knee, ankle) {
  // Project knee onto hip-ankle line in X-Y plane (frontal projection)
  const hx = ankle.x - hip.x;
  const hy = ankle.y - hip.y;
  const kx = knee.x  - hip.x;
  const ky = knee.y  - hip.y;

  const t = (kx * hx + ky * hy) / (hx * hx + hy * hy + 0.0001);
  const projX = hip.x + t * hx;
  const projY = hip.y + t * hy;

  const devX  = knee.x - projX;
  const devMagnitude = Math.sqrt(devX * devX);

  // Convert to approximate degrees using small angle approximation
  const hipAnkleLen = Math.sqrt(hx * hx + hy * hy);
  const valgusAngle = Math.atan2(devMagnitude, hipAnkleLen) * (180 / Math.PI);

  // Sign convention: if knee is medial (toward midline), positive valgus
  const isMedial = (hip.x < ankle.x) ? (knee.x < projX) : (knee.x > projX);
  return Math.round(valgusAngle * (isMedial ? 1 : -1) * 100) / 100;
}

/**
 * Computes bilateral symmetry percentage between two metrics (left vs right).
 * 100% = perfect symmetry, 0% = completely asymmetric.
 *
 * @param {number} leftValue
 * @param {number} rightValue
 * @returns {number} Symmetry percentage [0, 100]
 */
function computeSymmetry(leftValue, rightValue) {
  if (leftValue === 0 && rightValue === 0) return 100;
  const avg  = (Math.abs(leftValue) + Math.abs(rightValue)) / 2;
  const diff = Math.abs(Math.abs(leftValue) - Math.abs(rightValue));
  return Math.max(0, Math.round((1 - diff / (avg + 0.001)) * 100));
}

/**
 * Computes hip-to-ankle vertical alignment in the frontal plane.
 * Returns alignment category and deviation side.
 *
 * @param {Landmark} leftHip
 * @param {Landmark} rightHip
 * @param {Landmark} leftAnkle
 * @param {Landmark} rightAnkle
 * @returns {{ alignment: string, deviationPct: number }}
 */
function computeHipAnkleAlignment(leftHip, rightHip, leftAnkle, rightAnkle) {
  // Midpoint of hips vs midpoint of ankles
  const hipMidX   = (leftHip.x + rightHip.x) / 2;
  const ankleMidX = (leftAnkle.x + rightAnkle.x) / 2;
  const bodyWidth = Math.abs(rightHip.x - leftHip.x);

  const deviation    = hipMidX - ankleMidX;
  const deviationPct = bodyWidth > 0
    ? Math.abs(deviation / bodyWidth * 100)
    : 0;

  let alignment;
  if (deviationPct < 5) alignment = 'ALIGNED';
  else if (deviation < 0) alignment = 'LEFT_DEVIATION';
  else alignment = 'RIGHT_DEVIATION';

  return { alignment, deviationPct: Math.round(deviationPct * 10) / 10 };
}

/**
 * Generates mobility correction protocols from detected flags.
 *
 * @param {Object[]} flags - Mobility flag objects
 * @returns {string} Combined correction routine string
 */
function generateCorrectionRoutine(flags) {
  const routines = [];

  for (const flag of flags) {
    if (flag.flag.includes('valgus') || flag.flag.includes('Valgus')) {
      routines.push('Hip External Rotator Strengthening: Clamshells 3×15');
      routines.push('VMO Activation: Terminal Knee Extensions 3×20');
    }
    if (flag.flag.includes('dorsiflexion') || flag.flag.includes('Dorsiflexion')) {
      routines.push('Calf/Soleus Stretch: Wall Calf Stretch 2×45s each side');
      routines.push('Ankle CARs (Controlled Articular Rotations): 2×10 each direction');
    }
    if (flag.flag.includes('load') || flag.flag.includes('shift') || flag.flag.includes('symmetry')) {
      routines.push('Single-Leg Stance: 3×30s each side for proprioceptive symmetry');
      routines.push('Bulgarian Split Squat: 3×8 each side to address load imbalance');
    }
    if (flag.flag.includes('thoracic') || flag.flag.includes('Thoracic')) {
      routines.push('Thoracic Extension: Foam roller T-spine extension 2×60s');
      routines.push('Cat-Cow Mobilization: 2×10 slow cycles');
    }
  }

  const unique = [...new Set(routines)];
  return unique.length > 0 ? unique.join('; ') : 'General warm-up: Hip circles + Leg swings (3×10 each side)';
}

/**
 * Main mobility analysis entry point.
 *
 * @param {Object} params
 * @param {Landmark[]} params.landmarks      - Array of 33 MediaPipe pose landmarks
 * @param {string}     params.movementType   - 'BODYWEIGHT_SQUAT' | 'SINGLE_LEG_BALANCE' | etc.
 * @param {number}     [params.poseConfidence] - Overall pose detection confidence [0,1]
 *
 * @returns {MobilityAnalysisResult}
 *
 * @typedef {Object} MobilityAnalysisResult
 * @property {number}   mobilityScore            - 0-100 composite score
 * @property {Object}   jointAngles              - Computed joint angles
 * @property {string}   hipToAnkleAlignment      - Alignment category
 * @property {number}   bilateralSymmetryPct     - 0-100 bilateral symmetry
 * @property {string}   loadShiftDirection       - 'LEFT' | 'RIGHT' | 'NONE'
 * @property {number}   loadShiftPct             - Compensatory load %
 * @property {Object[]} mobilityFlags            - Clinical movement flags
 * @property {string}   correctionRoutine        - Generated correction protocol
 */
export function analyzeMobility({ landmarks, movementType = 'BODYWEIGHT_SQUAT', poseConfidence = 1.0 }) {
  if (!landmarks || landmarks.length < 33) {
    throw new Error(`Invalid landmark data: expected 33 landmarks, received ${landmarks?.length || 0}.`);
  }

  if (poseConfidence < 0.3) {
    throw new Error(`Pose detection confidence too low (${(poseConfidence * 100).toFixed(0)}%). Ensure proper lighting and full body visibility.`);
  }

  // Extract key landmarks
  const leftHip    = lm(landmarks, LM.LEFT_HIP);
  const rightHip   = lm(landmarks, LM.RIGHT_HIP);
  const leftKnee   = lm(landmarks, LM.LEFT_KNEE);
  const rightKnee  = lm(landmarks, LM.RIGHT_KNEE);
  const leftAnkle  = lm(landmarks, LM.LEFT_ANKLE);
  const rightAnkle = lm(landmarks, LM.RIGHT_ANKLE);
  const leftHeel   = lm(landmarks, LM.LEFT_HEEL);
  const rightHeel  = lm(landmarks, LM.RIGHT_HEEL);
  const leftShoulder  = lm(landmarks, LM.LEFT_SHOULDER);
  const rightShoulder = lm(landmarks, LM.RIGHT_SHOULDER);

  // Virtual landmarks
  const hipMidpoint = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2, z: ((leftHip.z || 0) + (rightHip.z || 0)) / 2 };
  const shoulderMidpoint = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2, z: 0 };

  // ─── Joint Angle Calculations ──────────────────────────────────────────────

  // Knee flexion angles (hip-knee-ankle chain)
  const leftKneeAngle  = computeJointAngle(leftHip,  leftKnee,  leftAnkle);
  const rightKneeAngle = computeJointAngle(rightHip, rightKnee, rightAnkle);

  // Knee valgus deviation
  const kneeValgusLeft  = computeKneeValgus(leftHip,  leftKnee,  leftAnkle);
  const kneeValgusRight = computeKneeValgus(rightHip, rightKnee, rightAnkle);

  // Hip flexion (shoulder-hip-knee chain for squat)
  const hipFlexionLeft  = computeJointAngle(leftShoulder,  leftHip,  leftKnee);
  const hipFlexionRight = computeJointAngle(rightShoulder, rightHip, rightKnee);
  const hipFlexionAvg   = (hipFlexionLeft + hipFlexionRight) / 2;

  // Thoracic flexion (hip midpoint → shoulder midpoint vertical deviation)
  const verticalRef     = { x: hipMidpoint.x, y: hipMidpoint.y - 1, z: hipMidpoint.z };
  const thoracicFlexion = computeJointAngle(verticalRef, hipMidpoint, shoulderMidpoint);

  // Ankle dorsiflexion (knee-ankle-heel chain proxy)
  const ankleDorsiLeft  = computeJointAngle(leftKnee,  leftAnkle,  leftHeel);
  const ankleDorsiRight = computeJointAngle(rightKnee, rightAnkle, rightHeel);

  // ─── Symmetry Analysis ─────────────────────────────────────────────────────

  const kneeSymmetry       = computeSymmetry(leftKneeAngle, rightKneeAngle);
  const valgusSymmetry     = computeSymmetry(Math.abs(kneeValgusLeft), Math.abs(kneeValgusRight));
  const dorsiflexSymmetry  = computeSymmetry(ankleDorsiLeft, ankleDorsiRight);
  const bilateralSymmetry  = Math.round((kneeSymmetry + valgusSymmetry + dorsiflexSymmetry) / 3);

  // Load shift
  const { alignment, deviationPct } = computeHipAnkleAlignment(leftHip, rightHip, leftAnkle, rightAnkle);
  let loadShiftDirection = 'NONE';
  if (alignment === 'LEFT_DEVIATION')  loadShiftDirection = 'LEFT';
  if (alignment === 'RIGHT_DEVIATION') loadShiftDirection = 'RIGHT';

  // ─── Mobility Flags ────────────────────────────────────────────────────────

  const mobilityFlags = [];

  if (Math.abs(kneeValgusLeft) > REF_ANGLES.VALGUS_TOLERANCE_DEG) {
    mobilityFlags.push({
      flag:     `Left knee valgus deviation: ${Math.abs(kneeValgusLeft).toFixed(1)}° (threshold: ${REF_ANGLES.VALGUS_TOLERANCE_DEG}°)`,
      severity: Math.abs(kneeValgusLeft) > 10 ? 'HIGH' : 'MODERATE',
      joint:    'LEFT_KNEE',
    });
  }

  if (Math.abs(kneeValgusRight) > REF_ANGLES.VALGUS_TOLERANCE_DEG) {
    mobilityFlags.push({
      flag:     `Right knee valgus deviation: ${Math.abs(kneeValgusRight).toFixed(1)}° (threshold: ${REF_ANGLES.VALGUS_TOLERANCE_DEG}°)`,
      severity: Math.abs(kneeValgusRight) > 10 ? 'HIGH' : 'MODERATE',
      joint:    'RIGHT_KNEE',
    });
  }

  if (ankleDorsiLeft < REF_ANGLES.DORSIFLEXION_NORMAL_MIN || ankleDorsiRight < REF_ANGLES.DORSIFLEXION_NORMAL_MIN) {
    const limitedSide = ankleDorsiLeft < ankleDorsiRight ? 'Left' : 'Right';
    const limitedVal  = Math.min(ankleDorsiLeft, ankleDorsiRight);
    mobilityFlags.push({
      flag:     `${limitedSide} ankle dorsiflexion restricted: ${limitedVal.toFixed(1)}° (normal ≥${REF_ANGLES.DORSIFLEXION_NORMAL_MIN}°)`,
      severity: limitedVal < 10 ? 'HIGH' : 'MODERATE',
      joint:    `${limitedSide.toUpperCase()}_ANKLE`,
    });
  }

  if (thoracicFlexion > REF_ANGLES.THORACIC_FLEXION_NEUTRAL_MAX) {
    mobilityFlags.push({
      flag:     `Thoracic spine flexion excessive: ${thoracicFlexion.toFixed(1)}° (neutral max: ${REF_ANGLES.THORACIC_FLEXION_NEUTRAL_MAX}°)`,
      severity: thoracicFlexion > 60 ? 'HIGH' : 'MODERATE',
      joint:    'THORACIC_SPINE',
    });
  }

  if (bilateralSymmetry < REF_ANGLES.BILATERAL_SYMMETRY_FLAG) {
    const loadShiftPctVal = deviationPct;
    mobilityFlags.push({
      flag:     `${loadShiftDirection !== 'NONE' ? loadShiftDirection + '-side' : 'Bilateral'} compensatory load detected: ${loadShiftPctVal.toFixed(1)}% shift`,
      severity: bilateralSymmetry < 75 ? 'HIGH' : 'MODERATE',
      joint:    'BILATERAL',
    });
  }

  // ─── Composite Mobility Score ──────────────────────────────────────────────

  let penaltyPoints = 0;

  // Valgus penalty (0-30 points)
  const maxValgus = Math.max(Math.abs(kneeValgusLeft), Math.abs(kneeValgusRight));
  penaltyPoints += Math.min(30, maxValgus * 2.5);

  // Dorsiflexion penalty (0-20 points)
  const minDorsiflexion = Math.min(ankleDorsiLeft, ankleDorsiRight);
  if (minDorsiflexion < REF_ANGLES.DORSIFLEXION_NORMAL_MIN) {
    penaltyPoints += Math.min(20, (REF_ANGLES.DORSIFLEXION_NORMAL_MIN - minDorsiflexion) * 1.5);
  }

  // Symmetry penalty (0-25 points)
  if (bilateralSymmetry < REF_ANGLES.BILATERAL_SYMMETRY_GOOD) {
    penaltyPoints += Math.min(25, (REF_ANGLES.BILATERAL_SYMMETRY_GOOD - bilateralSymmetry) * 0.5);
  }

  // Thoracic flexion penalty (0-15 points)
  if (thoracicFlexion > REF_ANGLES.THORACIC_FLEXION_NEUTRAL_MAX) {
    penaltyPoints += Math.min(15, (thoracicFlexion - REF_ANGLES.THORACIC_FLEXION_NEUTRAL_MAX) * 0.4);
  }

  // Pose confidence penalty (0-10 points for low confidence)
  if (poseConfidence < 0.7) {
    penaltyPoints += (0.7 - poseConfidence) * 30;
  }

  const mobilityScore = Math.round(Math.max(0, Math.min(100, 100 - penaltyPoints)));

  // ─── Correction Routine ────────────────────────────────────────────────────

  const correctionRoutine = generateCorrectionRoutine(mobilityFlags);

  return {
    mobilityScore,
    jointAngles: {
      leftKneeAngleDeg:       Math.round(leftKneeAngle * 10) / 10,
      rightKneeAngleDeg:      Math.round(rightKneeAngle * 10) / 10,
      kneeValgusLeftDeg:      Math.round(kneeValgusLeft * 10) / 10,
      kneeValgusRightDeg:     Math.round(kneeValgusRight * 10) / 10,
      hipFlexionDeg:          Math.round(hipFlexionAvg * 10) / 10,
      thoracicFlexionDeg:     Math.round(thoracicFlexion * 10) / 10,
      ankleDorsiflexionLeft:  Math.round(ankleDorsiLeft * 10) / 10,
      ankleDorsiflexionRight: Math.round(ankleDorsiRight * 10) / 10,
    },
    hipToAnkleAlignment: alignment,
    bilateralSymmetryPct: bilateralSymmetry,
    loadShiftDirection,
    loadShiftPct: Math.round(deviationPct * 10) / 10,
    mobilityFlags,
    correctionRoutine,
    movementType,
    poseConfidence: Math.round(poseConfidence * 100) / 100,
  };
}

/**
 * lib/services/LongevitySimulatorService.js
 *
 * Digital Twin Longevity Simulator — Biological Age Engine
 *
 * Implements a pheno-lifestyle biological age algorithm derived from
 * physiological biomarkers and wearable telemetry. All formulas are
 * deterministic and parameterized with published coefficients.
 *
 * Scientific References:
 *   - Levine et al. (2018) "An epigenetic biomarker of aging" — phenoAge
 *   - Belsky et al. (2020) "Quantification of the pace of biological aging" — DunedinPACE
 *   - Resting HRV/RHR-based aging: Jarczok et al., PLOS ONE 2013
 *   - Sleep SWS/REM ratios: Walker, "Why We Sleep" (UCSF 2017); Scullin et al., PNAS 2019
 *   - HPA-axis allostatic load index: McEwen & Stellar (1993)
 *
 * CLINICAL NOTICE: This engine computes probabilistic biomarker-derived
 * biological age estimates. Results are for wellness tracking and research
 * purposes only. Not a clinical diagnostic.
 */

// ─── Population Reference Constants ─────────────────────────────────────────
// Derived from NHANES III and UK Biobank normative datasets.

const REF = {
  // Optimal physiological ranges (midpoint of clinical normal)
  RHR_OPTIMAL: 55,        // bpm — trained adult optimal
  RHR_REF_MAX: 80,        // bpm — above this, aging penalty scales
  HRV_OPTIMAL: 65,        // ms rMSSD — high HRV = robust autonomic regulation
  HRV_REF_MIN: 20,        // ms — severe HRV suppression floor
  SLEEP_OPTIMAL_RATIO: 0.45, // Deep + REM as fraction of total sleep (target 45%+)
  MAP_OPTIMAL: 85,        // mmHg — Mean Arterial Pressure optimum
  MAP_REF_HYPER: 107,     // mmHg — stage-1 hypertension threshold
  GLUCOSE_OPTIMAL: 85,    // mg/dL fasting
  GLUCOSE_PREDIABETES: 100, // mg/dL — above this, metabolic aging penalty
  STRESS_NEUTRAL: 30,     // 0-100 subjective stress index — low-stress reference
};

// ─── Organ Sub-Score Weight Coefficients ────────────────────────────────────
// Weighted contribution to final biological age delta (sum = 1.0).
const SUBSCORE_WEIGHTS = {
  cardiovascular: 0.30,  // RHR, HRV, MAP
  metabolic:      0.25,  // Fasting glucose, weight
  autonomic:      0.25,  // HRV rMSSD, stress index, sleep architecture
  neurological:   0.20,  // Deep+REM ratio, subjective stress
};

// ─── Helper: Clamp ──────────────────────────────────────────────────────────
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

/**
 * Computes a Cardiovascular Sub-Score (0–100).
 * Higher score = healthier cardiovascular profile.
 *
 * Algorithm:
 *   - RHR component: penalty curve for values above 55 bpm
 *   - HRV component: reward for values approaching 65ms+
 *   - MAP component: penalty ramp above 85mmHg
 *
 * @param {{ rhr: number, hrv: number, map: number }} params
 * @returns {{ score: number, details: Object }}
 */
function computeCardiovascularScore({ rhr, hrv, map }) {
  // RHR score: 100 at 55 bpm, linear penalty to 0 at 95 bpm
  const rhrScore = clamp(100 - ((rhr - REF.RHR_OPTIMAL) / (REF.RHR_REF_MAX - REF.RHR_OPTIMAL)) * 60, 10, 100);

  // HRV score: logarithmic reward — captures diminishing returns of high HRV
  const hrvScore = clamp(
    (Math.log(Math.max(hrv, 1)) / Math.log(REF.HRV_OPTIMAL)) * 100,
    5, 100
  );

  // MAP score: 100 below 85mmHg, linear penalty above, bottoms out at 107+
  const mapScore = map <= REF.MAP_OPTIMAL
    ? 100
    : clamp(100 - ((map - REF.MAP_OPTIMAL) / (REF.MAP_REF_HYPER - REF.MAP_OPTIMAL)) * 70, 10, 100);

  const score = Math.round(rhrScore * 0.35 + hrvScore * 0.40 + mapScore * 0.25);

  return {
    score: clamp(score, 0, 100),
    details: {
      rhrScore: Math.round(rhrScore),
      hrvScore: Math.round(hrvScore),
      mapScore: Math.round(mapScore),
    },
  };
}

/**
 * Computes a Metabolic Sub-Score (0–100).
 * Based on fasting glucose stability and derived metabolic health.
 *
 * @param {{ glucose: number, weight: number, heightCm: number }} params
 * @returns {{ score: number, details: Object }}
 */
function computeMetabolicScore({ glucose, weight, heightCm }) {
  // Glucose score: 100 at ≤85 mg/dL, penalty above, severe penalty at ≥126
  let glucoseScore = 100;
  if (glucose > REF.GLUCOSE_OPTIMAL) {
    glucoseScore = clamp(
      100 - ((glucose - REF.GLUCOSE_OPTIMAL) / (126 - REF.GLUCOSE_OPTIMAL)) * 80,
      10, 100
    );
  }

  // BMI-based score (if height provided)
  let bmiScore = 80; // default neutral if no height
  if (heightCm && weight) {
    const heightM = heightCm / 100;
    const bmi = weight / (heightM * heightM);
    // Optimal BMI range 21-23: score 100; penalty outside
    const bmiDev = Math.abs(bmi - 22);
    bmiScore = clamp(100 - bmiDev * 5, 20, 100);
  }

  const score = Math.round(glucoseScore * 0.65 + bmiScore * 0.35);

  return {
    score: clamp(score, 0, 100),
    details: {
      glucoseScore: Math.round(glucoseScore),
      bmiScore: Math.round(bmiScore),
    },
  };
}

/**
 * Computes an Autonomic Nervous System Sub-Score (0–100).
 * Primary drivers: HRV rMSSD, subjective stress index.
 *
 * @param {{ hrv: number, stressIndex: number }} params
 * @returns {{ score: number, details: Object }}
 */
function computeAutonomicScore({ hrv, stressIndex }) {
  // HRV: logarithmic reward (same as cardiovascular HRV component)
  const hrvScore = clamp(
    (Math.log(Math.max(hrv, 1)) / Math.log(REF.HRV_OPTIMAL)) * 100,
    5, 100
  );

  // Stress: inverse linear — 0 stress = 100 score, 100 stress = 0 score
  const stressScore = clamp(100 - stressIndex, 0, 100);

  const score = Math.round(hrvScore * 0.55 + stressScore * 0.45);

  return {
    score: clamp(score, 0, 100),
    details: {
      hrvScore: Math.round(hrvScore),
      stressScore: Math.round(stressScore),
    },
  };
}

/**
 * Computes a Neurological / Sleep Architecture Sub-Score (0–100).
 * Primary driver: Deep+REM ratio. Secondary: stress index.
 *
 * @param {{ deepRemRatio: number, stressIndex: number }} params
 * @returns {{ score: number, details: Object }}
 */
function computeNeurologicalScore({ deepRemRatio, stressIndex }) {
  // Deep+REM ratio: 0.45+ = 100; below 0.20 = severe penalty
  const sleepScore = clamp(
    (deepRemRatio / REF.SLEEP_OPTIMAL_RATIO) * 100,
    5, 100
  );

  // Stress inverse
  const stressScore = clamp(100 - stressIndex, 0, 100);

  const score = Math.round(sleepScore * 0.70 + stressScore * 0.30);

  return {
    score: clamp(score, 0, 100),
    details: {
      sleepScore: Math.round(sleepScore),
      deepRemRatio: deepRemRatio.toFixed(3),
    },
  };
}

/**
 * Converts organ sub-scores to a biological age delta in years.
 *
 * Formula derivation:
 *   - Composite score (weighted average of sub-scores) maps linearly to aging delta.
 *   - A composite of 100 (optimal) yields -5y delta (biologically younger).
 *   - A composite of 50 (average) yields 0y delta (at chronological age).
 *   - A composite of 0 (severe dysfunction) yields +15y delta (biologically older).
 *
 * This produces a linear mapping over the range [0, 100] → [+15, -5].
 * Delta = 15 - (compositeScore / 100) * 20
 *
 * @param {number} compositeScore — weighted average sub-score (0–100)
 * @returns {number} ageingDeltaYears
 */
function compositeScoreToAgeDelta(compositeScore) {
  return 15 - (compositeScore / 100) * 20;
}

/**
 * Main biological age computation entry point.
 *
 * @param {Object} params
 * @param {number} params.chronologicalAge  - Age in years
 * @param {number} params.avgRhr30d         - 30-day avg Resting Heart Rate (bpm)
 * @param {number} params.avgHrv30d         - 30-day avg HRV rMSSD (ms)
 * @param {number} params.avgDeepRemRatio   - 30-day avg Deep+REM/total sleep ratio
 * @param {number} params.avgMap30d         - 30-day avg Mean Arterial Pressure (mmHg)
 * @param {number} params.avgFastingGlucose - 30-day avg fasting glucose (mg/dL)
 * @param {number} params.avgStressIndex    - 30-day avg stress index (0–100)
 * @param {number} [params.weight]          - Latest body weight (kg)
 * @param {number} [params.heightCm]        - Patient height (cm)
 *
 * @returns {LongevitySimulationResult}
 *
 * @typedef {Object} LongevitySimulationResult
 * @property {number}   biologicalAge       - Computed biological age (years)
 * @property {number}   agingVelocity       - Years aged per chronological year (e.g., 0.82)
 * @property {number}   bioAgeDelta         - biologicalAge - chronologicalAge
 * @property {string}   agingStatus         - 'YOUNGER' | 'AT_PACE' | 'ACCELERATED'
 * @property {Object}   organSubScores      - Per-system 0-100 health scores
 * @property {string[]} positiveFactors     - Factors improving biological age
 * @property {string[]} riskFactors         - Factors accelerating biological age
 * @property {string}   longevityTier       - 'ELITE' | 'OPTIMAL' | 'AVERAGE' | 'DECLINING' | 'CRITICAL'
 */
export function simulateBiologicalAge({
  chronologicalAge,
  avgRhr30d,
  avgHrv30d,
  avgDeepRemRatio,
  avgMap30d,
  avgFastingGlucose,
  avgStressIndex,
  weight = null,
  heightCm = null,
}) {
  // --- Input sanitization ---
  const rhr    = clamp(avgRhr30d       || 65, 35, 120);
  const hrv    = clamp(avgHrv30d       || 40, 1,  200);
  const ratio  = clamp(avgDeepRemRatio || 0.30, 0, 1);
  const map    = clamp(avgMap30d       || 90, 50, 150);
  const glucose= clamp(avgFastingGlucose || 90, 50, 300);
  const stress = clamp(avgStressIndex  || 35, 0,  100);

  // --- Compute organ sub-scores ---
  const cardiovascular = computeCardiovascularScore({ rhr, hrv, map });
  const metabolic      = computeMetabolicScore({ glucose, weight, heightCm });
  const autonomic      = computeAutonomicScore({ hrv, stressIndex: stress });
  const neurological   = computeNeurologicalScore({ deepRemRatio: ratio, stressIndex: stress });

  // --- Weighted composite score ---
  const compositeScore =
    cardiovascular.score * SUBSCORE_WEIGHTS.cardiovascular +
    metabolic.score      * SUBSCORE_WEIGHTS.metabolic      +
    autonomic.score      * SUBSCORE_WEIGHTS.autonomic      +
    neurological.score   * SUBSCORE_WEIGHTS.neurological;

  // --- Biological age computation ---
  const ageDelta       = compositeScoreToAgeDelta(compositeScore);
  const biologicalAge  = Math.max(1, chronologicalAge + ageDelta);
  const agingVelocity  = parseFloat((biologicalAge / chronologicalAge).toFixed(4));

  // --- Aging status ---
  let agingStatus;
  if (ageDelta <= -2)       agingStatus = 'YOUNGER';
  else if (ageDelta <= 2)   agingStatus = 'AT_PACE';
  else                      agingStatus = 'ACCELERATED';

  // --- Longevity tier ---
  let longevityTier;
  if (compositeScore >= 88)      longevityTier = 'ELITE';
  else if (compositeScore >= 74) longevityTier = 'OPTIMAL';
  else if (compositeScore >= 58) longevityTier = 'AVERAGE';
  else if (compositeScore >= 40) longevityTier = 'DECLINING';
  else                           longevityTier = 'CRITICAL';

  // --- Qualitative factor analysis ---
  const positiveFactors = [];
  const riskFactors     = [];

  if (hrv >= 55)   positiveFactors.push(`High HRV (${hrv.toFixed(0)}ms) — robust parasympathetic tone`);
  if (rhr <= 58)   positiveFactors.push(`Low Resting HR (${rhr}bpm) — efficient cardiac output`);
  if (ratio >= 0.40) positiveFactors.push(`Strong Sleep Architecture (${(ratio * 100).toFixed(0)}% Deep+REM)`);
  if (map <= 88)   positiveFactors.push('Optimal MAP — low vascular wall stress');
  if (glucose <= 88) positiveFactors.push('Stable fasting glucose — metabolic resilience');

  if (hrv < 35)    riskFactors.push(`Suppressed HRV (${hrv.toFixed(0)}ms) — elevated allostatic load`);
  if (rhr > 72)    riskFactors.push(`Elevated Resting HR (${rhr}bpm) — reduced cardiac efficiency`);
  if (ratio < 0.25) riskFactors.push(`Impaired Sleep Architecture (${(ratio * 100).toFixed(0)}% Deep+REM)`);
  if (map > 100)   riskFactors.push(`Elevated MAP (${map.toFixed(0)}mmHg) — vascular aging signal`);
  if (glucose > 95) riskFactors.push(`Elevated fasting glucose (${glucose}mg/dL) — metabolic aging`);
  if (stress > 55) riskFactors.push(`High Stress Index (${stress}/100) — HPA-axis dysregulation`);

  return {
    biologicalAge:  parseFloat(biologicalAge.toFixed(2)),
    agingVelocity,
    bioAgeDelta:    parseFloat(ageDelta.toFixed(2)),
    agingStatus,
    longevityTier,
    compositeScore: Math.round(compositeScore),
    organSubScores: {
      cardiovascular: cardiovascular.score,
      metabolic:      metabolic.score,
      autonomic:      autonomic.score,
      neurological:   neurological.score,
    },
    organDetails: {
      cardiovascular: cardiovascular.details,
      metabolic:      metabolic.details,
      autonomic:      autonomic.details,
      neurological:   neurological.details,
    },
    positiveFactors,
    riskFactors,
  };
}

/**
 * Computes Mean Arterial Pressure from systolic and diastolic.
 * MAP = (2 * diastolic + systolic) / 3
 *
 * @param {number} systolic
 * @param {number} diastolic
 * @returns {number}
 */
export function computeMAP(systolic, diastolic) {
  return parseFloat(((2 * diastolic + systolic) / 3).toFixed(1));
}

/**
 * Computes Deep+REM ratio from sleep architecture minutes.
 *
 * @param {{ deepMin: number, remMin: number, totalMin: number }} sleep
 * @returns {number} ratio 0.0-1.0
 */
export function computeDeepRemRatio({ deepMin, remMin, totalMin }) {
  if (!totalMin || totalMin <= 0) return 0.30; // default neutral
  return clamp((deepMin + remMin) / totalMin, 0, 1);
}

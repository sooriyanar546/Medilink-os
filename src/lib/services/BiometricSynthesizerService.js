/**
 * lib/services/BiometricSynthesizerService.js
 *
 * Biometric Synthesizer & Anomaly Detector
 *
 * Implements a rolling 7-day Z-score anomaly detection model for continuous
 * wearable telemetry (RHR, HRV rMSSD, Sleep, Respiratory Rate).
 *
 * Z-Score Anomaly Rule:
 *   Anomaly is triggered when current reading deviates by > 2 standard
 *   deviations from the patient's own 7-day rolling baseline.
 *   This is the same methodology used by Whoop, Apple Health, and Garmin
 *   for early illness/systemic inflammation detection.
 *
 * Immune Readiness Score Model:
 *   Composite 0-100 score synthesizing:
 *     - HRV component (40%): HRV above/below personal baseline
 *     - RHR component (35%): RHR above/below personal baseline
 *     - Sleep component (25%): Total sleep hours vs personal baseline
 *
 * References:
 *   - Shapiro et al. (2019) "Physiological echo of psychological stress" — HRV anomaly
 *   - Gu et al. (2020) Wearable-derived respiratory rate for illness detection — NPJ Digital Medicine
 *   - Drew et al. (2021) Smartwatch data detects COVID-19 — Nature Biomedical Engineering
 *
 * CLINICAL NOTICE: Anomaly events are proactive wellness alerts, NOT diagnoses.
 * All alerts require clinical interpretation.
 */

import { prisma } from '../prisma.js';

// ─── Anomaly Thresholds ──────────────────────────────────────────────────────
const ANOMALY_Z_THRESHOLD = 2.0;   // > 2σ from rolling baseline
const MIN_SAMPLE_SIZE     = 3;     // Minimum readings needed for reliable baseline

/**
 * Computes a 7-day rolling baseline (mean + stddev) for a numeric series.
 *
 * @param {number[]} values - Array of readings (most recent last)
 * @returns {{ mean: number, stddev: number, n: number }}
 */
export function computeRollingBaseline(values) {
  const valid = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (valid.length === 0) return { mean: 0, stddev: 0, n: 0 };

  const n    = valid.length;
  const mean = valid.reduce((sum, v) => sum + v, 0) / n;

  if (n === 1) return { mean, stddev: 0, n };

  const variance = valid.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
  const stddev   = Math.sqrt(variance);

  return { mean: parseFloat(mean.toFixed(3)), stddev: parseFloat(stddev.toFixed(3)), n };
}

/**
 * Computes the Z-score of a current reading against a baseline.
 *
 * @param {number} current
 * @param {number} mean
 * @param {number} stddev
 * @returns {number} Z-score (positive = above mean, negative = below mean)
 */
export function computeZScore(current, mean, stddev) {
  if (stddev === 0 || stddev < 0.001) return 0;
  return (current - mean) / stddev;
}

/**
 * Determines if a Z-score constitutes an anomaly event.
 * For RHR and RR: elevation is concerning (positive Z)
 * For HRV: suppression is concerning (negative Z, i.e. < -2σ)
 * For Sleep: reduction is concerning (negative Z)
 *
 * @param {number} zScore
 * @param {'RHR'|'HRV'|'SLEEP'|'RR'} metricType
 * @returns {{ isAnomaly: boolean, direction: string }}
 */
function evaluateAnomaly(zScore, metricType) {
  const absZ = Math.abs(zScore);
  if (absZ < ANOMALY_Z_THRESHOLD) return { isAnomaly: false, direction: 'NORMAL' };

  let direction;
  switch (metricType) {
    case 'RHR':
      direction = zScore > 0 ? 'ELEVATED' : 'LOW';
      return { isAnomaly: zScore > 0, direction }; // Only flag elevation as anomaly
    case 'HRV':
      direction = zScore < 0 ? 'SUPPRESSED' : 'ELEVATED';
      return { isAnomaly: zScore < 0, direction }; // Only flag suppression
    case 'SLEEP':
      direction = zScore < 0 ? 'REDUCED' : 'EXTENDED';
      return { isAnomaly: zScore < 0, direction }; // Only flag reduction
    case 'RR':
      direction = zScore > 0 ? 'ELEVATED' : 'LOW';
      return { isAnomaly: zScore > 0, direction }; // Only flag elevation
    default:
      return { isAnomaly: absZ >= ANOMALY_Z_THRESHOLD, direction: zScore > 0 ? 'ELEVATED' : 'REDUCED' };
  }
}

/**
 * Computes the Immune Readiness Score (0-100) from baseline-relative metrics.
 *
 * Algorithm:
 *   Each component is mapped from its Z-score to a 0-100 contribution:
 *   - Z-score 0 (at baseline) → 75 (healthy normal)
 *   - Z-score -2 (2σ suppressed) → 40 (concerning)
 *   - Z-score +2 (2σ elevated) → varies by metric direction
 *
 * @param {{ hrv: {current: number, baseline: {mean: number, stddev: number}},
 *            rhr: {current: number, baseline: {mean: number, stddev: number}},
 *            sleep: {current: number, baseline: {mean: number, stddev: number}} }} params
 * @returns {{ score: number, components: Object }}
 */
function computeImmuneReadinessScore({ hrv, rhr, sleep }) {
  // HRV component: higher HRV than baseline = better immune readiness
  const hrvZ         = computeZScore(hrv.current, hrv.baseline.mean, hrv.baseline.stddev);
  const hrvComponent = Math.round(Math.min(100, Math.max(0, 75 + hrvZ * 12.5)));

  // RHR component: lower RHR than baseline = better immune readiness (invert sign)
  const rhrZ         = computeZScore(rhr.current, rhr.baseline.mean, rhr.baseline.stddev);
  const rhrComponent = Math.round(Math.min(100, Math.max(0, 75 - rhrZ * 12.5)));

  // Sleep component: more sleep than baseline = better readiness
  const sleepZ         = computeZScore(sleep.current, sleep.baseline.mean, sleep.baseline.stddev);
  const sleepComponent = Math.round(Math.min(100, Math.max(0, 75 + sleepZ * 12.5)));

  const score = Math.round(
    hrvComponent   * 0.40 +
    rhrComponent   * 0.35 +
    sleepComponent * 0.25
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    components: {
      hrv:   { zScore: parseFloat(hrvZ.toFixed(2)),   score: hrvComponent  },
      rhr:   { zScore: parseFloat(rhrZ.toFixed(2)),   score: rhrComponent  },
      sleep: { zScore: parseFloat(sleepZ.toFixed(2)), score: sleepComponent },
    },
  };
}

/**
 * Fetches the 7-day rolling biometric window for a patient from vital_time_series.
 * Returns arrays of valid numeric readings for each biometric channel.
 *
 * @param {string} patientId
 * @returns {Promise<{ rhrValues: number[], hrvValues: number[], sleepValues: number[], rrValues: number[] }>}
 */
async function fetchSevenDayWindow(patientId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Raw SQL for performance — partitioned table requires explicit query
  const rows = await prisma.$queryRaw`
    SELECT
      heart_rate,
      hrv_rmssd,
      sleep_hours,
      respiratory_rate
    FROM vital_time_series
    WHERE patient_id = ${patientId}
      AND measured_at >= ${since}
    ORDER BY measured_at ASC
  `;

  return {
    rhrValues:   rows.map(r => r.heart_rate).filter(v => v !== null),
    hrvValues:   rows.map(r => r.hrv_rmssd).filter(v => v !== null).map(Number),
    sleepValues: rows.map(r => r.sleep_hours).filter(v => v !== null).map(Number),
    rrValues:    rows.map(r => r.respiratory_rate).filter(v => v !== null),
  };
}

/**
 * Main biometric synthesis and anomaly detection pipeline.
 *
 * @param {Object} params
 * @param {string} params.patientId
 * @param {number} params.currentRhr          - Current RHR reading (bpm)
 * @param {number} params.currentHrv          - Current HRV rMSSD (ms)
 * @param {number} params.currentSleepHours   - Current sleep total (hours)
 * @param {number} [params.currentRr]         - Current respiratory rate (breaths/min)
 *
 * @returns {Promise<BiometricSynthesisResult>}
 *
 * @typedef {Object} BiometricSynthesisResult
 * @property {number}       immuneReadinessScore
 * @property {boolean}      hasAnomaly
 * @property {AnomalyEvent[]} anomalyEvents
 * @property {Object}       baselines          - Rolling baselines for each metric
 * @property {Object}       zScores            - Current Z-scores
 */
export async function synthesizeBiometrics({
  patientId,
  currentRhr,
  currentHrv,
  currentSleepHours,
  currentRr,
}) {
  // 1. Fetch 7-day window
  const window = await fetchSevenDayWindow(patientId);

  // 2. Compute baselines
  const rhrBaseline   = computeRollingBaseline(window.rhrValues);
  const hrvBaseline   = computeRollingBaseline(window.hrvValues);
  const sleepBaseline = computeRollingBaseline(window.sleepValues);
  const rrBaseline    = computeRollingBaseline(window.rrValues);

  // 3. Compute Z-scores for current readings
  const rhrZ   = computeZScore(currentRhr,         rhrBaseline.mean,   rhrBaseline.stddev);
  const hrvZ   = computeZScore(currentHrv,         hrvBaseline.mean,   hrvBaseline.stddev);
  const sleepZ = computeZScore(currentSleepHours,  sleepBaseline.mean, sleepBaseline.stddev);
  const rrZ    = currentRr !== undefined
    ? computeZScore(currentRr, rrBaseline.mean, rrBaseline.stddev)
    : 0;

  // 4. Anomaly evaluation
  const anomalyEvents = [];

  const rhrAnomaly   = evaluateAnomaly(rhrZ, 'RHR');
  const hrvAnomaly   = evaluateAnomaly(hrvZ, 'HRV');
  const sleepAnomaly = evaluateAnomaly(sleepZ, 'SLEEP');
  const rrAnomaly    = currentRr !== undefined ? evaluateAnomaly(rrZ, 'RR') : { isAnomaly: false };

  if (rhrBaseline.n >= MIN_SAMPLE_SIZE && rhrAnomaly.isAnomaly) {
    anomalyEvents.push({
      metric:    'RHR',
      direction: rhrAnomaly.direction,
      current:   currentRhr,
      baseline:  rhrBaseline.mean,
      zScore:    parseFloat(rhrZ.toFixed(2)),
      severity:  Math.abs(rhrZ) >= 3 ? 'HIGH' : 'MODERATE',
      message:   `Resting Heart Rate elevated ${Math.abs(rhrZ).toFixed(1)}σ above 7-day baseline (${currentRhr} vs ${rhrBaseline.mean.toFixed(0)}bpm). Possible early systemic inflammation or autonomic stress.`,
    });
  }

  if (hrvBaseline.n >= MIN_SAMPLE_SIZE && hrvAnomaly.isAnomaly) {
    anomalyEvents.push({
      metric:    'HRV',
      direction: hrvAnomaly.direction,
      current:   currentHrv,
      baseline:  hrvBaseline.mean,
      zScore:    parseFloat(hrvZ.toFixed(2)),
      severity:  Math.abs(hrvZ) >= 3 ? 'HIGH' : 'MODERATE',
      message:   `HRV rMSSD suppressed ${Math.abs(hrvZ).toFixed(1)}σ below 7-day baseline (${currentHrv}ms vs ${hrvBaseline.mean.toFixed(0)}ms). Indicates elevated allostatic load or early illness onset.`,
    });
  }

  if (sleepBaseline.n >= MIN_SAMPLE_SIZE && sleepAnomaly.isAnomaly) {
    anomalyEvents.push({
      metric:    'SLEEP',
      direction: sleepAnomaly.direction,
      current:   currentSleepHours,
      baseline:  sleepBaseline.mean,
      zScore:    parseFloat(sleepZ.toFixed(2)),
      severity:  Math.abs(sleepZ) >= 3 ? 'HIGH' : 'MODERATE',
      message:   `Sleep duration ${Math.abs(sleepZ).toFixed(1)}σ below 7-day baseline (${currentSleepHours}h vs ${sleepBaseline.mean.toFixed(1)}h). Sleep debt accumulation detected.`,
    });
  }

  if (currentRr !== undefined && rrBaseline.n >= MIN_SAMPLE_SIZE && rrAnomaly.isAnomaly) {
    anomalyEvents.push({
      metric:    'RR',
      direction: rrAnomaly.direction,
      current:   currentRr,
      baseline:  rrBaseline.mean,
      zScore:    parseFloat(rrZ.toFixed(2)),
      severity:  Math.abs(rrZ) >= 3 ? 'HIGH' : 'MODERATE',
      message:   `Respiratory Rate elevated ${Math.abs(rrZ).toFixed(1)}σ above baseline (${currentRr} vs ${rrBaseline.mean.toFixed(0)} breaths/min). Possible respiratory or metabolic stress.`,
    });
  }

  // 5. Immune Readiness Score
  // Use mean as fallback current value if no baseline exists yet
  const immuneResult = computeImmuneReadinessScore({
    hrv:   { current: currentHrv,         baseline: { mean: hrvBaseline.mean   || currentHrv,   stddev: hrvBaseline.stddev   || 5 } },
    rhr:   { current: currentRhr,         baseline: { mean: rhrBaseline.mean   || currentRhr,   stddev: rhrBaseline.stddev   || 3 } },
    sleep: { current: currentSleepHours,  baseline: { mean: sleepBaseline.mean || currentSleepHours, stddev: sleepBaseline.stddev || 0.5 } },
  });

  return {
    immuneReadinessScore: immuneResult.score,
    immuneComponents:     immuneResult.components,
    hasAnomaly:           anomalyEvents.length > 0,
    anomalyEvents,
    baselines: {
      rhr:   rhrBaseline,
      hrv:   hrvBaseline,
      sleep: sleepBaseline,
      rr:    rrBaseline,
    },
    zScores: {
      rhr:   parseFloat(rhrZ.toFixed(2)),
      hrv:   parseFloat(hrvZ.toFixed(2)),
      sleep: parseFloat(sleepZ.toFixed(2)),
      rr:    parseFloat(rrZ.toFixed(2)),
    },
    dataQuality: {
      rhrSampleSize:   rhrBaseline.n,
      hrvSampleSize:   hrvBaseline.n,
      sleepSampleSize: sleepBaseline.n,
      hasEnoughData:   Math.min(rhrBaseline.n, hrvBaseline.n) >= MIN_SAMPLE_SIZE,
    },
  };
}

/**
 * Upserts today's biometric baseline record into biometric_daily_baselines.
 * Called after synthesis to persist rolling state.
 *
 * @param {string} patientId
 * @param {Object} synthesisResult - Result from synthesizeBiometrics()
 * @returns {Promise<void>}
 */
export async function persistDailyBaseline(patientId, synthesisResult) {
  const today = new Date().toISOString().split('T')[0];
  const { baselines, anomalyEvents, immuneReadinessScore } = synthesisResult;

  await prisma.$executeRaw`
    INSERT INTO biometric_daily_baselines (
      patient_id, baseline_date,
      rhr_mean, rhr_stddev, rhr_n,
      hrv_mean, hrv_stddev, hrv_n,
      sleep_mean, sleep_stddev, sleep_n,
      rr_mean, rr_stddev, rr_n,
      immune_readiness_score,
      rhr_anomaly, hrv_anomaly, sleep_anomaly,
      anomaly_events, computed_at
    ) VALUES (
      ${patientId}, ${today}::date,
      ${baselines.rhr.mean}, ${baselines.rhr.stddev}, ${baselines.rhr.n},
      ${baselines.hrv.mean}, ${baselines.hrv.stddev}, ${baselines.hrv.n},
      ${baselines.sleep.mean}, ${baselines.sleep.stddev}, ${baselines.sleep.n},
      ${baselines.rr.mean}, ${baselines.rr.stddev}, ${baselines.rr.n},
      ${immuneReadinessScore},
      ${anomalyEvents.some(e => e.metric === 'RHR')},
      ${anomalyEvents.some(e => e.metric === 'HRV')},
      ${anomalyEvents.some(e => e.metric === 'SLEEP')},
      ${JSON.stringify(anomalyEvents)}::jsonb,
      NOW()
    )
    ON CONFLICT (patient_id, baseline_date)
    DO UPDATE SET
      rhr_mean = EXCLUDED.rhr_mean, rhr_stddev = EXCLUDED.rhr_stddev, rhr_n = EXCLUDED.rhr_n,
      hrv_mean = EXCLUDED.hrv_mean, hrv_stddev = EXCLUDED.hrv_stddev, hrv_n = EXCLUDED.hrv_n,
      sleep_mean = EXCLUDED.sleep_mean, sleep_stddev = EXCLUDED.sleep_stddev, sleep_n = EXCLUDED.sleep_n,
      rr_mean = EXCLUDED.rr_mean, rr_stddev = EXCLUDED.rr_stddev, rr_n = EXCLUDED.rr_n,
      immune_readiness_score = EXCLUDED.immune_readiness_score,
      rhr_anomaly = EXCLUDED.rhr_anomaly,
      hrv_anomaly = EXCLUDED.hrv_anomaly,
      sleep_anomaly = EXCLUDED.sleep_anomaly,
      anomaly_events = EXCLUDED.anomaly_events,
      computed_at = NOW()
  `;
}

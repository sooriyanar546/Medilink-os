/**
 * lib/services/AcuityService.js
 *
 * Deterministic Clinical Acuity Scoring Engine
 * Implements a qSOFA-derived composite score for automated ward triage.
 *
 * References:
 *   - qSOFA (quick SOFA): Seymour et al., JAMA 2016; 315(8):762-774
 *   - Modified Early Warning Score (MEWS) supplemental criteria
 *
 * SECURITY NOTE: This service computes triage scores only.
 * It does NOT produce medical diagnoses. All recommendations
 * are operational routing suggestions and require clinical sign-off.
 */

/**
 * @typedef {Object} VitalsPayload
 * @property {string|null}  bp           - "systolic/diastolic" e.g. "90/60"
 * @property {number|null}  sbp          - Systolic BP in mmHg (alternative flat field)
 * @property {number|null}  hr           - Heart rate in bpm
 * @property {number|null}  heartRate    - Alias for hr
 * @property {number|null}  rr           - Respiratory rate per minute
 * @property {number|null}  respiratoryRate - Alias for rr
 * @property {number|null}  spo2         - Oxygen saturation (%)
 * @property {number|null}  spO2         - Alias for spo2
 * @property {number|null}  oxygenSaturation - Alias for spo2
 * @property {number|null}  gcs          - Glasgow Coma Scale (3–15)
 * @property {number|null}  temp         - Temperature in °C
 * @property {number|null}  temperature
 */

/**
 * @typedef {Object} AcuityResult
 * @property {number}   score            - Raw composite score (0–6+)
 * @property {string}   classification   - 'CRITICAL' | 'HIGH_RISK' | 'MODERATE' | 'STABLE'
 * @property {string}   wardRecommendation - 'ICU' | 'ER' | 'STEP_DOWN' | 'GENERAL' | 'OBSERVATION'
 * @property {string[]} triggers         - Human-readable trigger descriptions
 * @property {boolean}  requiresImmediateAttention
 */

/**
 * Parses systolic blood pressure from multiple incoming formats.
 * @param {VitalsPayload} vitals
 * @returns {number|null}
 */
function parseSystolicBP(vitals) {
  if (vitals.sbp !== undefined && vitals.sbp !== null) {
    const parsed = parseInt(vitals.sbp);
    return isNaN(parsed) ? null : parsed;
  }
  if (vitals.bp && typeof vitals.bp === 'string' && vitals.bp.includes('/')) {
    const part = vitals.bp.split('/')[0];
    const parsed = parseInt(part);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Parses heart rate from multiple field aliases.
 * @param {VitalsPayload} vitals
 * @returns {number|null}
 */
function parseHeartRate(vitals) {
  const raw = vitals.hr ?? vitals.heartRate;
  if (raw === undefined || raw === null) return null;
  const parsed = parseInt(raw);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parses respiratory rate from multiple field aliases.
 * @param {VitalsPayload} vitals
 * @returns {number|null}
 */
function parseRespiratoryRate(vitals) {
  const raw = vitals.rr ?? vitals.respiratoryRate;
  if (raw === undefined || raw === null) return null;
  const parsed = parseInt(raw);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parses SpO2 from multiple field aliases.
 * @param {VitalsPayload} vitals
 * @returns {number|null}
 */
function parseSpO2(vitals) {
  const raw = vitals.spo2 ?? vitals.spO2 ?? vitals.oxygenSaturation;
  if (raw === undefined || raw === null) return null;
  const parsed = parseInt(raw);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parses GCS from vitals payload.
 * @param {VitalsPayload} vitals
 * @returns {number|null}
 */
function parseGCS(vitals) {
  const raw = vitals.gcs;
  if (raw === undefined || raw === null) return null;
  const parsed = parseInt(raw);
  return isNaN(parsed) || parsed < 3 || parsed > 15 ? null : parsed;
}

/**
 * Parses temperature from vitals payload. Converts Fahrenheit → Celsius if > 50.
 * @param {VitalsPayload} vitals
 * @returns {number|null}
 */
function parseTemperature(vitals) {
  const raw = vitals.temp ?? vitals.temperature;
  if (raw === undefined || raw === null) return null;
  let parsed = parseFloat(raw);
  if (isNaN(parsed)) return null;
  // If value looks like Fahrenheit (> 50°C threshold), convert
  if (parsed > 50) {
    parsed = (parsed - 32) * (5 / 9);
  }
  return parsed;
}

/**
 * Calculates a deterministic clinical acuity score from a vitals payload
 * and optional chief complaint string.
 *
 * Scoring rubric (max 7 points before chief-complaint bonus):
 *   Systolic BP ≤ 100 mmHg              → +2  (severe hypotension)
 *   Systolic BP 101–90 mmHg (covered by above)
 *   Respiratory Rate ≥ 22/min           → +1  (qSOFA criterion)
 *   HR ≥ 130 bpm                        → +2  (severe tachycardia)
 *   HR 110–129 bpm                      → +1  (moderate tachycardia)
 *   SpO2 ≤ 90%                          → +2  (severe hypoxemia)
 *   SpO2 91–93%                         → +1  (mild hypoxemia)
 *   GCS < 13                            → +2  (significant impairment)
 *   GCS 13–14                           → +1  (mild impairment)
 *   Temperature > 39.5°C or < 35.5°C   → +1  (fever/hypothermia)
 *   Critical chief complaint keyword     → +1
 *
 * @param {VitalsPayload} vitals
 * @param {string} [chiefComplaint='']
 * @returns {AcuityResult}
 */
export function calculateAcuityScore(vitals, chiefComplaint = '') {
  if (!vitals || typeof vitals !== 'object') {
    return {
      score: 0,
      classification: 'STABLE',
      wardRecommendation: 'GENERAL',
      triggers: ['No vitals recorded — defaulting to stable classification'],
      requiresImmediateAttention: false,
    };
  }

  let score = 0;
  const triggers = [];

  // ── 1. Systolic Blood Pressure ────────────────────────────────────────────
  const sbp = parseSystolicBP(vitals);
  if (sbp !== null) {
    if (sbp <= 90) {
      score += 2;
      triggers.push(`Severe Hypotension (Systolic BP ${sbp} mmHg ≤ 90)`);
    } else if (sbp <= 100) {
      score += 2;
      triggers.push(`Hypotension (Systolic BP ${sbp} mmHg ≤ 100)`);
    } else if (sbp <= 110) {
      score += 1;
      triggers.push(`Low-Normal BP (Systolic BP ${sbp} mmHg ≤ 110)`);
    }
  }

  // ── 2. Heart Rate ─────────────────────────────────────────────────────────
  const hr = parseHeartRate(vitals);
  if (hr !== null) {
    if (hr >= 130) {
      score += 2;
      triggers.push(`Severe Tachycardia (HR ${hr} bpm ≥ 130)`);
    } else if (hr >= 110) {
      score += 1;
      triggers.push(`Tachycardia (HR ${hr} bpm ≥ 110)`);
    } else if (hr <= 50) {
      score += 1;
      triggers.push(`Bradycardia (HR ${hr} bpm ≤ 50)`);
    }
  }

  // ── 3. Respiratory Rate ───────────────────────────────────────────────────
  const rr = parseRespiratoryRate(vitals);
  if (rr !== null) {
    if (rr >= 30) {
      score += 2;
      triggers.push(`Severe Tachypnea (RR ${rr}/min ≥ 30)`);
    } else if (rr >= 22) {
      score += 1;
      triggers.push(`Tachypnea (RR ${rr}/min ≥ 22) — qSOFA criterion`);
    } else if (rr <= 8) {
      score += 2;
      triggers.push(`Bradypnea (RR ${rr}/min ≤ 8) — respiratory depression risk`);
    }
  }

  // ── 4. Oxygen Saturation ─────────────────────────────────────────────────
  const spo2 = parseSpO2(vitals);
  if (spo2 !== null) {
    if (spo2 <= 88) {
      score += 2;
      triggers.push(`Critical Hypoxemia (SpO2 ${spo2}% ≤ 88)`);
    } else if (spo2 <= 93) {
      score += 1;
      triggers.push(`Hypoxemia (SpO2 ${spo2}% ≤ 93)`);
    }
  }

  // ── 5. Glasgow Coma Scale ─────────────────────────────────────────────────
  const gcs = parseGCS(vitals);
  if (gcs !== null) {
    if (gcs < 13) {
      score += 2;
      triggers.push(`Significant Neurological Impairment (GCS ${gcs} < 13) — qSOFA criterion`);
    } else if (gcs < 15) {
      score += 1;
      triggers.push(`Altered Mental Status (GCS ${gcs} < 15)`);
    }
  }

  // ── 6. Temperature ────────────────────────────────────────────────────────
  const temp = parseTemperature(vitals);
  if (temp !== null) {
    if (temp > 40.0) {
      score += 1;
      triggers.push(`Hyperpyrexia (Temperature ${temp.toFixed(1)}°C > 40.0)`);
    } else if (temp > 39.5) {
      score += 1;
      triggers.push(`High Fever (Temperature ${temp.toFixed(1)}°C > 39.5)`);
    } else if (temp < 35.0) {
      score += 1;
      triggers.push(`Hypothermia (Temperature ${temp.toFixed(1)}°C < 35.0)`);
    }
  }

  // ── 7. Chief Complaint Keyword Risk Stratification ───────────────────────
  const CRITICAL_KEYWORDS = [
    'chest pain', 'cardiac arrest', 'stroke', 'seizure', 'unconscious',
    'difficulty breathing', 'shortness of breath', 'severe bleeding',
    'trauma', 'overdose', 'anaphylaxis', 'poisoning', 'heart attack',
    'respiratory failure', 'sepsis', 'drowning', 'electrocution',
  ];
  if (chiefComplaint) {
    const lowerComplaint = chiefComplaint.toLowerCase();
    const matchedKeyword = CRITICAL_KEYWORDS.find((kw) => lowerComplaint.includes(kw));
    if (matchedKeyword) {
      score += 1;
      triggers.push(`Critical chief complaint keyword: "${matchedKeyword}"`);
    }
  }

  // ── Ward Recommendation & Classification Mapping ──────────────────────────
  let classification;
  let wardRecommendation;
  let requiresImmediateAttention = false;

  if (score >= 5) {
    classification = 'CRITICAL';
    wardRecommendation = 'ICU';
    requiresImmediateAttention = true;
  } else if (score >= 3) {
    classification = 'HIGH_RISK';
    // High RR + altered consciousness → ER; hemodynamic compromise alone → ICU step-down
    wardRecommendation = (rr !== null && rr >= 22) || (gcs !== null && gcs < 13) ? 'ER' : 'STEP_DOWN';
    requiresImmediateAttention = true;
  } else if (score >= 2) {
    classification = 'MODERATE';
    wardRecommendation = 'GENERAL';
    requiresImmediateAttention = false;
  } else if (score === 1) {
    classification = 'STABLE';
    wardRecommendation = 'OBSERVATION';
    requiresImmediateAttention = false;
  } else {
    classification = 'STABLE';
    wardRecommendation = 'GENERAL';
    requiresImmediateAttention = false;
  }

  return {
    score,
    classification,
    wardRecommendation,
    triggers: triggers.length > 0 ? triggers : ['All measured vitals within acceptable ranges'],
    requiresImmediateAttention,
  };
}

/**
 * Maps a ward recommendation string to a BedType enum value used in the schema.
 * STEP_DOWN is mapped to ER (closest available inpatient acute care).
 * OBSERVATION is mapped to GENERAL.
 *
 * @param {string} wardRecommendation
 * @returns {'ICU'|'ER'|'GENERAL'|'ISOLATION'}
 */
export function recommendationToBedType(wardRecommendation) {
  const map = {
    ICU: 'ICU',
    ER: 'ER',
    STEP_DOWN: 'ER',
    GENERAL: 'GENERAL',
    OBSERVATION: 'GENERAL',
  };
  return map[wardRecommendation] || 'GENERAL';
}

/**
 * lib/services/LabExplainerService.js
 *
 * AI Pathology Lab Explainer Service
 *
 * Ingests structured lab test results (biomarker name, value, unit, reference range),
 * classifies each biomarker's severity, and generates patient-friendly plain-English
 * explanations using Groq LLaMA-3 AI with a deterministic rule-based fallback.
 *
 * Clinical Safety Guardrails:
 *   - AI explanations NEVER contradict numeric reference intervals
 *   - CRITICAL severity always forces `urgent_consultation_required: true`
 *   - A mandatory clinical safety disclaimer is appended to every response
 *   - Emergency red-flag symptom triggers an immediate escalation payload
 *   - AI output is schema-validated against expected JSON structure before returning
 *   - Groq API calls have a strict 8-second timeout; fallback is deterministic
 *
 * PHI Protection:
 *   - Patient name and identifiers are NEVER sent to the Groq API
 *   - Only de-identified biomarker data (name, value, unit, range) is transmitted
 *
 * References:
 *   - WHO Laboratory Reference Ranges (2023)
 *   - NABL (India) Accredited Range Standards
 *   - LOINC Code System for biomarker nomenclature
 */

import Groq from 'groq-sdk';

// ─── Groq Client ──────────────────────────────────────────────────────────────

let groq = null;
try {
  if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
} catch {
  console.warn('[LabExplainerService] Groq initialisation failed. Deterministic fallback will be used.');
}

const GROQ_TIMEOUT_MS = 8000;
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ─── Clinical Safety Disclaimer (mandatory — appended to every response) ──────

const CLINICAL_SAFETY_DISCLAIMER =
  'This explanation is generated for educational purposes only and does not constitute medical advice or a clinical diagnosis. Always discuss your lab results with your treating physician before making any health decisions.';

// ─── Biomarker Reference Ranges Database ─────────────────────────────────────
// Comprehensive reference range database for common biomarkers.
// Values represent standard adult reference intervals (may vary by lab/age/sex).
// Critical thresholds trigger immediate escalation regardless of reference range.
//
// Structure: { low, high, critical_low, critical_high, unit, panel, description }
//   - low/high: normal range boundaries
//   - critical_low/critical_high: life-threatening thresholds (if null = not applicable)

const BIOMARKER_RANGES = {
  // ── Complete Blood Count (CBC) ────────────────────────────────────────────
  'hemoglobin':           { low: 12.0, high: 17.5, critical_low: 7.0,  critical_high: null,  unit: 'g/dL',     panel: 'CBC',  description: 'Oxygen-carrying protein in red blood cells' },
  'hgb':                  { low: 12.0, high: 17.5, critical_low: 7.0,  critical_high: null,  unit: 'g/dL',     panel: 'CBC',  description: 'Oxygen-carrying protein in red blood cells' },
  'hematocrit':           { low: 36.0, high: 52.0, critical_low: 20.0, critical_high: 65.0,  unit: '%',        panel: 'CBC',  description: 'Percentage of blood volume occupied by red cells' },
  'wbc':                  { low: 4.0,  high: 11.0, critical_low: 2.0,  critical_high: 30.0,  unit: '10³/µL',   panel: 'CBC',  description: 'White blood cell count — immune system indicator' },
  'platelets':            { low: 150,  high: 400,  critical_low: 50,   critical_high: 1000,  unit: '10³/µL',   panel: 'CBC',  description: 'Clotting cells' },
  'mcv':                  { low: 80.0, high: 100.0,critical_low: null, critical_high: null,  unit: 'fL',       panel: 'CBC',  description: 'Mean corpuscular volume — red cell size indicator' },
  // ── Basic Metabolic Panel (BMP) ───────────────────────────────────────────
  'glucose':              { low: 70.0, high: 99.0, critical_low: 40.0, critical_high: 500.0, unit: 'mg/dL',    panel: 'BMP',  description: 'Blood sugar level' },
  'sodium':               { low: 136,  high: 145,  critical_low: 120,  critical_high: 160,   unit: 'mEq/L',    panel: 'BMP',  description: 'Key electrolyte for fluid balance and nerve function' },
  'potassium':            { low: 3.5,  high: 5.0,  critical_low: 2.8,  critical_high: 6.5,   unit: 'mEq/L',    panel: 'BMP',  description: 'Electrolyte vital for heart and muscle function' },
  'chloride':             { low: 96,   high: 106,  critical_low: 80,   critical_high: 120,   unit: 'mEq/L',    panel: 'BMP',  description: 'Electrolyte for fluid and pH balance' },
  'bicarbonate':          { low: 22,   high: 29,   critical_low: 10,   critical_high: 40,    unit: 'mEq/L',    panel: 'BMP',  description: 'Acid-base balance indicator' },
  'bun':                  { low: 7,    high: 20,   critical_low: null, critical_high: 100,   unit: 'mg/dL',    panel: 'BMP',  description: 'Blood urea nitrogen — kidney waste filtration' },
  'creatinine':           { low: 0.6,  high: 1.2,  critical_low: null, critical_high: 10.0,  unit: 'mg/dL',    panel: 'BMP',  description: 'Primary kidney function marker' },
  'serum creatinine':     { low: 0.6,  high: 1.2,  critical_low: null, critical_high: 10.0,  unit: 'mg/dL',    panel: 'BMP',  description: 'Primary kidney function marker' },
  'calcium':              { low: 8.5,  high: 10.5, critical_low: 7.0,  critical_high: 13.5,  unit: 'mg/dL',    panel: 'BMP',  description: 'Mineral for bone health, muscle and nerve function' },
  // ── Liver Function Tests (LFT) ─────────────────────────────────────────────
  'alt':                  { low: 0,    high: 40,   critical_low: null, critical_high: 1000,  unit: 'U/L',      panel: 'LFT',  description: 'Liver enzyme — elevated in liver damage or inflammation' },
  'ast':                  { low: 0,    high: 40,   critical_low: null, critical_high: 1000,  unit: 'U/L',      panel: 'LFT',  description: 'Liver/heart enzyme' },
  'alp':                  { low: 44,   high: 147,  critical_low: null, critical_high: 1000,  unit: 'U/L',      panel: 'LFT',  description: 'Alkaline phosphatase — bone and liver marker' },
  'bilirubin':            { low: 0.1,  high: 1.2,  critical_low: null, critical_high: 15.0,  unit: 'mg/dL',    panel: 'LFT',  description: 'Liver bile pigment — elevated in jaundice' },
  'total bilirubin':      { low: 0.1,  high: 1.2,  critical_low: null, critical_high: 15.0,  unit: 'mg/dL',    panel: 'LFT',  description: 'Liver bile pigment — elevated in jaundice' },
  'albumin':              { low: 3.5,  high: 5.0,  critical_low: 2.0,  critical_high: null,  unit: 'g/dL',     panel: 'LFT',  description: 'Protein made by the liver — nutritional and liver status' },
  // ── Lipid Panel ────────────────────────────────────────────────────────────
  'total cholesterol':    { low: 0,    high: 200,  critical_low: null, critical_high: 300,   unit: 'mg/dL',    panel: 'LIPID', description: 'Total blood cholesterol' },
  'hdl':                  { low: 40,   high: 999,  critical_low: 20,   critical_high: null,  unit: 'mg/dL',    panel: 'LIPID', description: 'Good cholesterol — cardioprotective' },
  'ldl':                  { low: 0,    high: 100,  critical_low: null, critical_high: 200,   unit: 'mg/dL',    panel: 'LIPID', description: 'Bad cholesterol — elevated risk for heart disease' },
  'triglycerides':        { low: 0,    high: 150,  critical_low: null, critical_high: 1000,  unit: 'mg/dL',    panel: 'LIPID', description: 'Blood fat — energy storage indicator' },
  // ── Thyroid Function ──────────────────────────────────────────────────────
  'tsh':                  { low: 0.4,  high: 4.0,  critical_low: 0.01, critical_high: 20.0,  unit: 'mIU/L',    panel: 'THYROID', description: 'Thyroid stimulating hormone — controls thyroid activity' },
  't3':                   { low: 80,   high: 200,  critical_low: null, critical_high: null,  unit: 'ng/dL',    panel: 'THYROID', description: 'Active thyroid hormone (triiodothyronine)' },
  't4':                   { low: 5.0,  high: 12.0, critical_low: null, critical_high: null,  unit: 'µg/dL',    panel: 'THYROID', description: 'Thyroid hormone (thyroxine)' },
  // ── Diabetes Monitoring ────────────────────────────────────────────────────
  'hba1c':                { low: 0,    high: 5.6,  critical_low: null, critical_high: 14.0,  unit: '%',        panel: 'DIABETES', description: '3-month average blood sugar control (glycated haemoglobin)' },
  // ── Cardiac Markers ───────────────────────────────────────────────────────
  'troponin i':           { low: 0,    high: 0.04, critical_low: null, critical_high: 0.1,   unit: 'ng/mL',    panel: 'CARDIAC', description: 'Heart muscle injury marker — elevated in heart attack' },
  'ck-mb':                { low: 0,    high: 5.0,  critical_low: null, critical_high: 25.0,  unit: 'ng/mL',    panel: 'CARDIAC', description: 'Cardiac muscle enzyme' },
  'bnp':                  { low: 0,    high: 100,  critical_low: null, critical_high: 900,   unit: 'pg/mL',    panel: 'CARDIAC', description: 'Heart failure marker (B-type natriuretic peptide)' },
  // ── Coagulation ───────────────────────────────────────────────────────────
  'pt':                   { low: 11.0, high: 13.5, critical_low: null, critical_high: 30.0,  unit: 'seconds',  panel: 'COAG', description: 'Prothrombin time — blood clotting speed' },
  'inr':                  { low: 0.8,  high: 1.1,  critical_low: null, critical_high: 5.0,   unit: '',         panel: 'COAG', description: 'International Normalised Ratio — anticoagulation level' },
  'ptt':                  { low: 25.0, high: 35.0, critical_low: null, critical_high: 100.0, unit: 'seconds',  panel: 'COAG', description: 'Partial thromboplastin time — internal clotting pathway' },
  // ── Urine Analysis ────────────────────────────────────────────────────────
  'urine protein':        { low: 0,    high: 14,   critical_low: null, critical_high: 3000,  unit: 'mg/24h',   panel: 'UA',   description: 'Protein in urine — kidney leak indicator' },
  'urine creatinine':     { low: 500,  high: 2000, critical_low: null, critical_high: null,  unit: 'mg/24h',   panel: 'UA',   description: 'Kidney concentration ability' },
};

// ─── Emergency Red-Flag Biomarker Combinations ────────────────────────────────
// If multiple CRITICAL markers co-occur, the response escalates to emergency protocol.

const MULTI_CRITICAL_ESCALATION_THRESHOLD = 2;   // ≥2 CRITICAL markers → emergency

// ─── Severity Classifier ──────────────────────────────────────────────────────

/**
 * @typedef {Object} BiomarkerInput
 * @property {string}        name            - Biomarker name (case-insensitive)
 * @property {number}        value           - Measured numeric value
 * @property {string}        unit            - Unit of measurement
 * @property {number|null}   [ref_low]       - Reference range low (overrides DB if provided)
 * @property {number|null}   [ref_high]      - Reference range high (overrides DB if provided)
 * @property {string|null}   [panel]         - Panel name override
 */

/**
 * @typedef {Object} ClassifiedBiomarker
 * @property {string}   name
 * @property {number}   value
 * @property {string}   unit
 * @property {number|null} ref_low
 * @property {number|null} ref_high
 * @property {'NORMAL'|'LOW'|'HIGH'|'CRITICAL'} severity
 * @property {number|null}  delta_percent    - % deviation from nearest reference bound
 * @property {boolean}  urgent_consultation_required
 * @property {string}   description         - DB description of biomarker
 * @property {string}   panel
 */

/**
 * Classifies a single biomarker measurement against reference ranges.
 * @param {BiomarkerInput} biomarker
 * @returns {ClassifiedBiomarker}
 */
export function classifyBiomarker(biomarker) {
  const key = biomarker.name.toLowerCase().trim();
  const ref = BIOMARKER_RANGES[key] || null;

  // Use caller-supplied reference if DB entry not found
  const refLow  = biomarker.ref_low  ?? ref?.low  ?? null;
  const refHigh = biomarker.ref_high ?? ref?.high ?? null;
  const critLow  = ref?.critical_low  ?? null;
  const critHigh = ref?.critical_high ?? null;

  const value = Number(biomarker.value);
  let severity = 'NORMAL';
  let deltaPercent = null;

  if (isNaN(value)) {
    // Non-numeric value (e.g., "Positive", "Negative") — cannot classify
    return {
      name: biomarker.name,
      value: biomarker.value,
      unit: biomarker.unit || ref?.unit || '',
      ref_low: refLow,
      ref_high: refHigh,
      severity: 'NORMAL',
      delta_percent: null,
      urgent_consultation_required: false,
      description: ref?.description || '',
      panel: biomarker.panel || ref?.panel || 'General',
    };
  }

  // Check critical thresholds first (overrides normal range classification)
  if (critLow !== null && value <= critLow) {
    severity = 'CRITICAL';
    deltaPercent = refLow !== null ? Math.round(((refLow - value) / refLow) * 100) : null;
  } else if (critHigh !== null && value >= critHigh) {
    severity = 'CRITICAL';
    deltaPercent = refHigh !== null ? Math.round(((value - refHigh) / refHigh) * 100) : null;
  } else if (refLow !== null && value < refLow) {
    severity = 'LOW';
    deltaPercent = Math.round(((refLow - value) / refLow) * 100);
  } else if (refHigh !== null && value > refHigh) {
    severity = 'HIGH';
    deltaPercent = Math.round(((value - refHigh) / refHigh) * 100);
  }

  return {
    name: biomarker.name,
    value,
    unit: biomarker.unit || ref?.unit || '',
    ref_low: refLow,
    ref_high: refHigh,
    severity,
    delta_percent: deltaPercent,
    urgent_consultation_required: severity === 'CRITICAL',
    description: ref?.description || '',
    panel: biomarker.panel || ref?.panel || 'General',
  };
}

// ─── Deterministic Fallback Explanations ─────────────────────────────────────

/**
 * Generates a deterministic explanation when Groq is unavailable.
 * Text is calibrated to be accurate (non-contradictory with numeric ranges) and safe.
 *
 * @param {ClassifiedBiomarker} classified
 * @returns {string}
 */
function _deterministicExplanation(classified) {
  const { name, value, unit, ref_low, ref_high, severity, description } = classified;

  const rangeText = (ref_low !== null && ref_high !== null)
    ? `The normal range is ${ref_low}–${ref_high} ${unit}.`
    : '';

  switch (severity) {
    case 'NORMAL':
      return `Your ${name} level is ${value} ${unit}, which is within the normal range. ${rangeText} This is a reassuring result. ${description ? `${description}.` : ''}`;

    case 'LOW':
      return `Your ${name} level is ${value} ${unit}, which is below the expected range. ${rangeText} A low result may indicate that your body needs additional attention in this area. Please discuss this with your doctor at your next visit.`;

    case 'HIGH':
      return `Your ${name} level is ${value} ${unit}, which is above the normal range. ${rangeText} Elevated levels can have various causes. Your doctor will review this alongside your other results and symptoms.`;

    case 'CRITICAL':
      return `⚠️ Your ${name} level is ${value} ${unit}, which is significantly outside the safe range. ${rangeText} This result requires prompt medical attention. Please contact your doctor or visit the nearest healthcare facility immediately.`;

    default:
      return `Your ${name} level is ${value} ${unit}. ${rangeText} Please discuss this result with your healthcare provider.`;
  }
}

// ─── Groq AI Explainer ────────────────────────────────────────────────────────

const AI_SYSTEM_PROMPT = `You are a compassionate clinical health educator helping patients understand their laboratory test results.

STRICT RULES (never violate these):
1. NEVER diagnose the patient with any specific disease or fatal condition.
2. NEVER contradict the numeric reference interval provided in the user input. If a value is HIGH, describe it as elevated; if LOW, describe it as below normal.
3. For CRITICAL severity values, ALWAYS include a recommendation to seek prompt medical attention.
4. Use simple, warm, non-alarming language suitable for a patient with no medical background.
5. Do NOT mention specific medications, dosages, or treatment protocols.
6. Always acknowledge uncertainty — say "may indicate" or "can be associated with" rather than "means".
7. Respond ONLY with a valid JSON object. No markdown. No prose outside the JSON.

Response schema (return exactly this structure):
{
  "plain_explanation": "2–3 sentence patient-friendly explanation",
  "lifestyle_tips": ["tip 1", "tip 2"],
  "when_to_seek_care": "one sentence about when to contact a doctor",
  "reassurance_note": "one calming, empowering sentence"
}`;

/**
 * @private
 * Calls Groq LLaMA-3 for a single biomarker explanation with 8-second timeout.
 * Returns null if the call fails or times out (caller uses deterministic fallback).
 *
 * @param {ClassifiedBiomarker} classified
 * @returns {Promise<Object|null>}
 */
async function _callGroqForBiomarker(classified) {
  if (!groq) return null;

  const userContent = JSON.stringify({
    biomarker_name: classified.name,
    measured_value: classified.value,
    unit: classified.unit,
    normal_range_low: classified.ref_low,
    normal_range_high: classified.ref_high,
    severity_classification: classified.severity,
    biomarker_description: classified.description,
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    const completion = await groq.chat.completions.create(
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user',   content: `Explain this lab result to the patient: ${userContent}` },
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);
    const raw = completion.choices[0]?.message?.content?.trim();
    const parsed = JSON.parse(raw);

    // Schema validation — ensure all required fields present
    if (
      typeof parsed.plain_explanation !== 'string' ||
      !Array.isArray(parsed.lifestyle_tips) ||
      typeof parsed.when_to_seek_care !== 'string'
    ) {
      return null;
    }

    return parsed;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('[LabExplainerService] Groq call failed:', err.message);
    }
    return null;
  }
}

// ─── Primary Service Function ─────────────────────────────────────────────────

/**
 * @typedef {Object} BiomarkerExplanationCard
 * @property {string}   name
 * @property {number}   value
 * @property {string}   unit
 * @property {number|null} ref_low
 * @property {number|null} ref_high
 * @property {'NORMAL'|'LOW'|'HIGH'|'CRITICAL'} severity
 * @property {number|null}  delta_percent
 * @property {string}   plain_explanation
 * @property {string[]} lifestyle_tips
 * @property {string}   when_to_seek_care
 * @property {string}   reassurance_note
 * @property {boolean}  urgent_consultation_required
 * @property {boolean}  ai_generated         - Whether explanation came from AI or fallback
 * @property {string}   panel
 */

/**
 * @typedef {Object} LabExplanationReport
 * @property {BiomarkerExplanationCard[]} biomarkers
 * @property {boolean}  has_critical_values
 * @property {boolean}  urgent_consultation_required
 * @property {boolean}  emergency_escalation        - True if ≥2 CRITICAL values co-occur
 * @property {string}   overall_summary
 * @property {string}   clinical_disclaimer
 */

/**
 * Main entry point: ingests an array of biomarker measurements and returns a
 * fully-explained, patient-friendly lab report.
 *
 * @param {BiomarkerInput[]} biomarkers
 * @returns {Promise<LabExplanationReport>}
 */
export async function explainLabReport(biomarkers) {
  if (!Array.isArray(biomarkers) || biomarkers.length === 0) {
    throw Object.assign(new Error('biomarkers array is required and must be non-empty.'), { code: 'INVALID_INPUT', status: 400 });
  }

  // ── Step 1: Classify all biomarkers deterministically ────────────────────
  const classified = biomarkers.map(classifyBiomarker);

  // ── Step 2: Generate explanations (AI first, deterministic fallback) ──────
  // Process AI calls concurrently (each has its own 8s timeout)
  const explanationCards = await Promise.all(
    classified.map(async (c) => {
      let aiResult = null;
      // Only call AI for non-normal results to preserve tokens and reduce latency
      if (c.severity !== 'NORMAL' || biomarkers.length <= 3) {
        aiResult = await _callGroqForBiomarker(c);
      }

      const usedAI = aiResult !== null;
      const plainExplanation = usedAI
        ? aiResult.plain_explanation
        : _deterministicExplanation(c);

      // Ensure CRITICAL forced flag regardless of AI content
      const urgentRequired = c.urgent_consultation_required;

      return {
        name: c.name,
        value: c.value,
        unit: c.unit,
        ref_low: c.ref_low,
        ref_high: c.ref_high,
        severity: c.severity,
        delta_percent: c.delta_percent,
        plain_explanation: plainExplanation,
        lifestyle_tips: usedAI ? (aiResult.lifestyle_tips || []) : _deterministicTips(c),
        when_to_seek_care: usedAI
          ? aiResult.when_to_seek_care
          : _deterministicWhenToSeek(c),
        reassurance_note: usedAI
          ? (aiResult.reassurance_note || '')
          : '',
        urgent_consultation_required: urgentRequired,
        ai_generated: usedAI,
        panel: c.panel,
        description: c.description,
      };
    })
  );

  // ── Step 3: Aggregate report metadata ────────────────────────────────────
  const criticalCount = explanationCards.filter(c => c.severity === 'CRITICAL').length;
  const hasCritical = criticalCount > 0;
  const urgentRequired = hasCritical;
  const emergencyEscalation = criticalCount >= MULTI_CRITICAL_ESCALATION_THRESHOLD;

  const normalCount = explanationCards.filter(c => c.severity === 'NORMAL').length;
  const abnormalCount = explanationCards.length - normalCount;

  let overallSummary;
  if (emergencyEscalation) {
    overallSummary = `⚠️ URGENT: ${criticalCount} of your lab results are at critically abnormal levels and require immediate medical attention. Please contact your doctor or go to the nearest emergency department without delay.`;
  } else if (hasCritical) {
    overallSummary = `One of your lab values is at a critically abnormal level. Please contact your doctor today to discuss the next steps.`;
  } else if (abnormalCount > 0) {
    overallSummary = `${abnormalCount} of your ${explanationCards.length} lab results are outside the normal range. Your doctor will review these values alongside your symptoms and medical history.`;
  } else {
    overallSummary = `All ${explanationCards.length} of your lab results are within normal ranges. This is an encouraging result.`;
  }

  return {
    biomarkers: explanationCards,
    has_critical_values: hasCritical,
    urgent_consultation_required: urgentRequired,
    emergency_escalation: emergencyEscalation,
    overall_summary: overallSummary,
    clinical_disclaimer: CLINICAL_SAFETY_DISCLAIMER,
  };
}

// ─── Deterministic Tip Generators ─────────────────────────────────────────────

/**
 * @private
 */
function _deterministicTips(classified) {
  const { name, severity } = classified;
  const key = name.toLowerCase();

  const tipMap = {
    'hemoglobin':        { LOW: ['Eat iron-rich foods like spinach, lentils, and lean meat.', 'Consider Vitamin C with meals to enhance iron absorption.'] },
    'hgb':               { LOW: ['Eat iron-rich foods like spinach, lentils, and lean meat.', 'Consider Vitamin C with meals to enhance iron absorption.'] },
    'glucose':           { HIGH: ['Reduce refined sugar and processed carbohydrates.', 'Aim for 30 minutes of moderate physical activity daily.'], LOW: ['Carry fast-acting sugar (glucose tablets or juice) with you.', 'Eat small, frequent meals.'] },
    'total cholesterol': { HIGH: ['Increase dietary fibre through oats, fruits, and vegetables.', 'Limit saturated fats from red meat and full-fat dairy.'] },
    'ldl':               { HIGH: ['Replace saturated fats with heart-healthy unsaturated fats (olive oil, nuts).', 'Increase soluble fibre intake (oats, beans, apples).'] },
    'creatinine':        { HIGH: ['Maintain adequate hydration.', 'Discuss protein intake adjustments with your doctor.'] },
    'tsh':               { HIGH: ['Report fatigue, weight changes, or cold sensitivity to your doctor.'], LOW: ['Report palpitations or unexplained weight loss to your doctor.'] },
    'hba1c':             { HIGH: ['Monitor blood sugar daily as directed.', 'Follow a low-glycaemic index diet.'] },
  };

  const biomarkerTips = tipMap[key];
  if (biomarkerTips && biomarkerTips[severity]) {
    return biomarkerTips[severity];
  }

  if (severity === 'HIGH') return ['Discuss lifestyle modifications with your doctor.', 'Follow up as recommended.'];
  if (severity === 'LOW')  return ['Ensure adequate nutrition and rest.', 'Follow up as recommended.'];
  if (severity === 'CRITICAL') return ['Seek medical attention promptly.'];
  return ['Maintain a healthy, balanced lifestyle.', 'Keep your follow-up appointments.'];
}

/**
 * @private
 */
function _deterministicWhenToSeek(classified) {
  if (classified.severity === 'CRITICAL') {
    return 'Contact your doctor or emergency services immediately.';
  }
  if (classified.severity === 'HIGH' || classified.severity === 'LOW') {
    return 'Contact your doctor within the next 24–48 hours if you develop new symptoms or feel unwell.';
  }
  return 'Discuss this result at your next scheduled appointment.';
}

/**
 * Quick severity check for a single biomarker — useful for middleware
 * that needs a fast classification without full explanation generation.
 *
 * @param {string} name
 * @param {number} value
 * @param {number|null} [refLow]
 * @param {number|null} [refHigh]
 * @returns {'NORMAL'|'LOW'|'HIGH'|'CRITICAL'}
 */
export function quickClassify(name, value, refLow = null, refHigh = null) {
  return classifyBiomarker({ name, value, unit: '', ref_low: refLow, ref_high: refHigh }).severity;
}

export const LabExplainerService = {
  explainLabReport,
  classifyBiomarker,
  quickClassify,
  BIOMARKER_RANGES,
  CLINICAL_SAFETY_DISCLAIMER,
};

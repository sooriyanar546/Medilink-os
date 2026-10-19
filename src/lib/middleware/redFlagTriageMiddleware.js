/**
 * lib/middleware/redFlagTriageMiddleware.js
 *
 * Deterministic Clinical Safety Red-Flag Triage Engine & Middleware
 *
 * Scans patient communications (MediBuddy chat, symptom reports, intake forms)
 * for life-threatening acute medical emergencies and provides instantaneous,
 * deterministic triage intervention.
 *
 * Triage Tiers:
 *   - CRITICAL_EMERGENCY: Immediate life threat. System short-circuits standard AI
 *     and delivers emergency protocol instructions (call 112/911/108, go to nearest ER).
 *   - URGENT_CARE: Acute symptoms requiring clinical review within 2-4 hours.
 *   - ROUTINE: Safe for standard informational/operational assistance.
 *
 * CLINICAL NOTE: This is a risk mitigation guardrail designed to prevent AI chat
 * systems from delaying emergency medical care. It does not replace 911 or clinical triage.
 */

import { logAudit } from '../audit.js';

// ─── Emergency Red-Flag Lexicon ───────────────────────────────────────────────

const EMERGENCY_RED_FLAGS = [
  // ── Cardiovascular / Ischemic ──────────────────────────────────────────────
  {
    category: 'CARDIOVASCULAR',
    severity: 'CRITICAL_EMERGENCY',
    patterns: [
      /\bcrushing\s+(?:chest\s+)?pain\b/i,
      /\bchest\s+pain\s+(?:radiat|spread|moving)\s+to\s+(?:left\s+arm|jaw|neck|back)\b/i,
      /\bheart\s+attack\b/i,
      /\bsevere\s+chest\s+tightness\b/i,
      /\bchest\s+pressure\s+with\s+(?:sweat|nausea|shortness\s+of\s+breath)\b/i,
    ],
    guidance: 'You may be experiencing a cardiac emergency. Call 112 / 108 / 911 immediately or have someone drive you to the nearest Emergency Department. Do NOT drive yourself. Chew an aspirin (325mg) if advised by emergency dispatchers and you are not allergic.',
  },

  // ── Respiratory / Airway ───────────────────────────────────────────────────
  {
    category: 'RESPIRATORY',
    severity: 'CRITICAL_EMERGENCY',
    patterns: [
      /\b(?:cannot|can't|unable\s+to)\s+breathe\b/i,
      /\bsevere\s+shortness\s+of\s+breath\b/i,
      /\bchoking\b/i,
      /\bblue\s+(?:lips|fingers|skin)\b/i,
      /\bgasping\s+for\s+air\b/i,
      /\bstridor\b/i,
      /\bthroat\s+(?:closing|closing\s+up|swollen\s+shut)\b/i,
    ],
    guidance: 'You may have an acute respiratory compromise or severe airway obstruction. Sit upright, loosen any tight clothing around your neck, and call 112 / 108 / 911 immediately.',
  },

  // ── Neurological / Acute Stroke (FAST) ──────────────────────────────────────
  {
    category: 'NEUROLOGICAL_STROKE',
    severity: 'CRITICAL_EMERGENCY',
    patterns: [
      /\b(?:facial|face)\s+droop(?:ing)?\b/i,
      /\b(?:one\s+sided|arm|leg)\s+weakness\b/i,
      /\bsudden\s+slurr(?:ed)?\s+speech\b/i,
      /\bunable\s+to\s+speak\s+clearly\b/i,
      /\bworst\s+headache\s+of\s+(?:my\s+)?life\b/i,
      /\bthunderclap\s+headache\b/i,
      /\bsudden\s+loss\s+of\s+vision\b/i,
      /\bactive\s+seizure\b/i,
    ],
    guidance: 'These symptoms can indicate an acute stroke or cerebral hemorrhage (FAST protocol). Time is critical. Call 112 / 108 / 911 immediately. Note the exact time symptoms started and do not eat or drink anything.',
  },

  // ── Anaphylaxis / Severe Allergy ───────────────────────────────────────────
  {
    category: 'ANAPHYLAXIS',
    severity: 'CRITICAL_EMERGENCY',
    patterns: [
      /\banaphylax(?:is)?\b/i,
      /\bswollen\s+(?:tongue|throat|lips)\s+after\s+(?:eating|medication|sting|bite)\b/i,
      /\bhives\s+with\s+(?:difficulty\s+breathing|dizziness|fainting)\b/i,
    ],
    guidance: 'This may be a severe, life-threatening allergic reaction (anaphylaxis). Use an epinephrine auto-injector (EpiPen) immediately if you have one prescribed, then call 112 / 108 / 911 right away.',
  },

  // ── Hemorrhage & Acute Trauma ──────────────────────────────────────────────
  {
    category: 'HEMORRHAGE_TRAUMA',
    severity: 'CRITICAL_EMERGENCY',
    patterns: [
      /\bvomit(?:ing)?\s+(?:blood|coffee\s+grounds?)\b/i,
      /\bcough(?:ing)?\s+up\s+large\s+amounts?\s+of\s+blood\b/i,
      /\buncontrolled\s+bleed(?:ing)?\b/i,
      /\bhead\s+injury\s+with\s+(?:loss\s+of\s+consciousness|vomiting)\b/i,
      /\bstab(?:bed)?\b/i,
      /\bgunshot\b/i,
    ],
    guidance: 'Severe acute bleeding or head trauma requires immediate emergency trauma care. Apply firm, continuous pressure to any bleeding site with a clean cloth. Call 112 / 108 / 911 immediately.',
  },

  // ── Crisis / Self-Harm ─────────────────────────────────────────────────────
  {
    category: 'MENTAL_HEALTH_CRISIS',
    severity: 'CRITICAL_EMERGENCY',
    patterns: [
      /\b(?:want\s+to\s+die|kill\s+myself|commit\s+suicide|end\s+my\s+life)\b/i,
      /\bsuicid(?:al|e)\s+thoughts?\b/i,
      /\bself[\s-]harm(?:ing)?\b/i,
      /\boverdose(?:d)?\s+on\s+pills\b/i,
    ],
    guidance: 'If you or someone you know is in crisis, support is available right now: In India, call the Tele-MANAS helpline at 14416 or 1800-891-4416 (24/7 free). In the US/Canada, call or text 988 (Suicide & Crisis Lifeline). In the UK, call 111. You are not alone and help is immediately available.',
  },

  // ── High Urgent Concerns ───────────────────────────────────────────────────
  {
    category: 'ACUTE_INFECTION_OR_PAIN',
    severity: 'URGENT_CARE',
    patterns: [
      /\bstiff\s+neck\s+with\s+(?:high\s+)?fever\b/i,
      /\bsevere\s+abdominal\s+pain\s+(?:right\s+lower|cannot\s+touch)\b/i,
      /\btesticular\s+pain\s+sudden\b/i,
      /\bfever\s+above\s+104\b/i,
    ],
    guidance: 'Your symptoms suggest an acute condition that requires urgent medical evaluation within 2 to 4 hours. Please go to an Urgent Care clinic or Emergency Department promptly.',
  },
];

// ─── Vital Signs Critical Thresholds ──────────────────────────────────────────

const VITAL_THRESHOLDS = {
  sbp: { critical_low: 80, critical_high: 200, label: 'Systolic Blood Pressure' },
  spo2: { critical_low: 88, critical_high: null, label: 'Oxygen Saturation (SpO2)' },
  heartRate: { critical_low: 40, critical_high: 140, label: 'Heart Rate' },
  temperature: { critical_low: 35.0, critical_high: 40.0, label: 'Body Temperature' },
};

/**
 * Pure deterministic evaluation of text and optional vitals for emergency red flags.
 *
 * @param {string} text - Message or chief complaint from patient
 * @param {Object} [vitals] - Optional recorded vitals { sbp, hr, spo2, temp }
 * @returns {{
 *   isRedFlag: boolean,
 *   severity: 'CRITICAL_EMERGENCY'|'URGENT_CARE'|'ROUTINE',
 *   matchedTriggers: Array<{ category: string, pattern: string, severity: string }>,
 *   guidance: string|null,
 *   disclaimer: string
 * }}
 */
export function evaluateRedFlags(text = '', vitals = null) {
  const normalizedText = String(text || '').trim();
  const matchedTriggers = [];
  let highestSeverity = 'ROUTINE';
  let guidanceText = null;

  // 1. Scan text with regex patterns
  for (const flag of EMERGENCY_RED_FLAGS) {
    for (const pattern of flag.patterns) {
      if (pattern.test(normalizedText)) {
        matchedTriggers.push({
          category: flag.category,
          pattern: pattern.source,
          severity: flag.severity,
        });

        if (flag.severity === 'CRITICAL_EMERGENCY') {
          highestSeverity = 'CRITICAL_EMERGENCY';
          guidanceText = guidanceText ? `${guidanceText}\n\n${flag.guidance}` : flag.guidance;
          break; // One match per category is enough
        } else if (flag.severity === 'URGENT_CARE' && highestSeverity !== 'CRITICAL_EMERGENCY') {
          highestSeverity = 'URGENT_CARE';
          if (!guidanceText) guidanceText = flag.guidance;
        }
      }
    }
  }

  // 2. Check vitals if provided
  if (vitals && typeof vitals === 'object') {
    const sbp = parseFloat(vitals.sbp || vitals.bp?.split('/')[0]);
    const spo2 = parseFloat(vitals.spo2 || vitals.spO2);
    const hr = parseFloat(vitals.hr || vitals.heartRate);
    const temp = parseFloat(vitals.temp || vitals.temperature);

    if (!isNaN(spo2) && spo2 <= VITAL_THRESHOLDS.spo2.critical_low) {
      matchedTriggers.push({ category: 'VITALS_SPO2', pattern: `SpO2 ${spo2}% <= 88%`, severity: 'CRITICAL_EMERGENCY' });
      highestSeverity = 'CRITICAL_EMERGENCY';
      guidanceText = (guidanceText || '') + '\nYour measured oxygen level is dangerously low. Call 112 / 108 / 911 immediately.';
    }

    if (!isNaN(sbp) && (sbp <= VITAL_THRESHOLDS.sbp.critical_low || sbp >= VITAL_THRESHOLDS.sbp.critical_high)) {
      matchedTriggers.push({ category: 'VITALS_BP', pattern: `SBP ${sbp} out of range [80, 200]`, severity: 'CRITICAL_EMERGENCY' });
      highestSeverity = 'CRITICAL_EMERGENCY';
      guidanceText = (guidanceText || '') + '\nYour blood pressure is in a critical zone requiring immediate emergency evaluation.';
    }

    if (!isNaN(hr) && (hr <= VITAL_THRESHOLDS.heartRate.critical_low || hr >= VITAL_THRESHOLDS.heartRate.critical_high)) {
      matchedTriggers.push({ category: 'VITALS_HR', pattern: `Heart rate ${hr} out of range [40, 140]`, severity: 'CRITICAL_EMERGENCY' });
      highestSeverity = 'CRITICAL_EMERGENCY';
    }

    if (!isNaN(temp) && (temp >= VITAL_THRESHOLDS.temperature.critical_high || temp <= VITAL_THRESHOLDS.temperature.critical_low)) {
      matchedTriggers.push({ category: 'VITALS_TEMP', pattern: `Temp ${temp}°C out of range [35.0, 40.0]`, severity: 'URGENT_CARE' });
      if (highestSeverity === 'ROUTINE') highestSeverity = 'URGENT_CARE';
    }
  }

  return {
    isRedFlag: highestSeverity !== 'ROUTINE',
    severity: highestSeverity,
    matchedTriggers,
    guidance: guidanceText ? guidanceText.trim() : null,
    emergencyHotlines: {
      india: ['112 (National Emergency)', '108 (Ambulance)', '14416 (Tele-MANAS Mental Health)'],
      us: ['911 (Emergency)', '988 (Crisis Hotline)'],
      uk: ['999 (Emergency)', '111 (NHS Urgent)'],
    },
    disclaimer:
      'MediLink AI does not replace emergency medical personnel or clinical diagnosis. If you are experiencing a life-threatening symptom, proceed immediately to the nearest emergency facility.',
  };
}

/**
 * Route wrapper that intercepts emergency messages and returns immediate safety payloads
 * or attaches triage metadata to the request for the inner handler.
 *
 * @param {Function} handler - Inner route handler (req, session, triageContext) => Response
 * @returns {Function}
 */
export function withRedFlagTriage(handler) {
  return async function redFlagTriageGuarded(request, ...args) {
    let body = null;
    let textToScan = '';
    let vitals = null;

    if (request.method === 'POST' || request.method === 'PATCH') {
      try {
        const cloned = request.clone();
        body = await cloned.json();
        textToScan = body?.message || body?.symptoms || body?.chiefComplaint || body?.text || '';
        vitals = body?.vitals || null;
      } catch {
        // Non-JSON or empty body
      }
    }

    const triageResult = evaluateRedFlags(textToScan, vitals);

    // If critical emergency detected in conversational chat, log audit
    if (triageResult.severity === 'CRITICAL_EMERGENCY') {
      logAudit(
        body?.patientId || 'anonymous_patient',
        'Patient Triage System',
        'SYSTEM',
        'RED_FLAG_TRIAGE_ALERT',
        body?.patientId || null,
        {
          triggers: triageResult.matchedTriggers,
          severity: triageResult.severity,
          timestamp: new Date().toISOString(),
        }
      ).catch((err) => console.error('[RedFlagTriage] Audit log failed:', err));
    }

    // Pass triage context into the handler
    return handler(request, triageResult, body, ...args);
  };
}

export const RedFlagTriage = {
  evaluateRedFlags,
  withRedFlagTriage,
  EMERGENCY_RED_FLAGS,
  VITAL_THRESHOLDS,
};

export default RedFlagTriage;

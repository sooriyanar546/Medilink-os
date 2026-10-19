/**
 * lib/services/SigTranslatorService.js
 *
 * Deterministic Prescription Sig (Signatura) Translation Engine
 *
 * Translates standard Latin prescription abbreviations into structured,
 * patient-friendly daily medication schedules.
 *
 * Parsing strategy (fail-forward):
 *   1. Deterministic dictionary matching (primary — always attempted first)
 *   2. Regex tokenizer for composite / freeform sigs
 *   3. Graceful partial-parse with flagged unparsed tokens (never throws)
 *
 * CLINICAL NOTE: This service produces administrative scheduling guidance only.
 * It does NOT substitute clinical judgment. All schedules require pharmacist review.
 *
 * References:
 *   - ISMP Standard Abbreviations (2023)
 *   - USP <795> Prescription Labeling Guidelines
 *   - Indian Pharmacopoeia Abbreviations Annex 3 (2022)
 */

// ─── Frequency Dictionary ────────────────────────────────────────────────────
// Maps normalised frequency codes to structured timing data.
// doses_per_day:  Number of distinct dose events per calendar day.
// interval_hours: Ideal interval between doses in hours (null = non-fixed).
// timing_slots:   Default clock-time labels if no explicit timing code given.

const FREQUENCY_DICT = {
  // ── Fixed Interval Frequencies ─────────────────────────────────────────────
  QD:    { label: 'once daily',            doses_per_day: 1,  interval_hours: 24, timing_slots: ['Morning'] },
  OD:    { label: 'once daily',            doses_per_day: 1,  interval_hours: 24, timing_slots: ['Morning'] },
  QAM:   { label: 'every morning',         doses_per_day: 1,  interval_hours: 24, timing_slots: ['Morning'] },
  QPM:   { label: 'every evening',         doses_per_day: 1,  interval_hours: 24, timing_slots: ['Evening'] },
  BID:   { label: 'twice daily',           doses_per_day: 2,  interval_hours: 12, timing_slots: ['Morning', 'Night'] },
  BD:    { label: 'twice daily',           doses_per_day: 2,  interval_hours: 12, timing_slots: ['Morning', 'Night'] },
  TID:   { label: 'three times daily',     doses_per_day: 3,  interval_hours: 8,  timing_slots: ['Morning', 'Afternoon', 'Night'] },
  TD:    { label: 'three times daily',     doses_per_day: 3,  interval_hours: 8,  timing_slots: ['Morning', 'Afternoon', 'Night'] },
  QID:   { label: 'four times daily',      doses_per_day: 4,  interval_hours: 6,  timing_slots: ['Morning', 'Midday', 'Afternoon', 'Night'] },
  QDS:   { label: 'four times daily',      doses_per_day: 4,  interval_hours: 6,  timing_slots: ['Morning', 'Midday', 'Afternoon', 'Night'] },
  Q4H:   { label: 'every 4 hours',         doses_per_day: 6,  interval_hours: 4,  timing_slots: ['06:00', '10:00', '14:00', '18:00', '22:00', '02:00'] },
  Q6H:   { label: 'every 6 hours',         doses_per_day: 4,  interval_hours: 6,  timing_slots: ['06:00', '12:00', '18:00', '00:00'] },
  Q8H:   { label: 'every 8 hours',         doses_per_day: 3,  interval_hours: 8,  timing_slots: ['06:00', '14:00', '22:00'] },
  Q12H:  { label: 'every 12 hours',        doses_per_day: 2,  interval_hours: 12, timing_slots: ['Morning', 'Night'] },
  // ── Weekly / Alternate Day ─────────────────────────────────────────────────
  QOD:   { label: 'every other day',       doses_per_day: 0.5, interval_hours: 48, timing_slots: ['Morning (alternate days)'] },
  QW:    { label: 'once weekly',           doses_per_day: null, interval_hours: 168, timing_slots: ['Once per week — specify day with pharmacist'] },
  BIW:   { label: 'twice weekly',          doses_per_day: null, interval_hours: 84,  timing_slots: ['Twice per week — specify days with pharmacist'] },
  // ── Special Frequencies ────────────────────────────────────────────────────
  HS:    { label: 'at bedtime',            doses_per_day: 1,  interval_hours: 24, timing_slots: ['Bedtime (9–10 PM)'] },
  QHS:   { label: 'at bedtime',            doses_per_day: 1,  interval_hours: 24, timing_slots: ['Bedtime (9–10 PM)'] },
  NOCTE: { label: 'at night',              doses_per_day: 1,  interval_hours: 24, timing_slots: ['Night'] },
  MANE:  { label: 'in the morning',        doses_per_day: 1,  interval_hours: 24, timing_slots: ['Morning'] },
  STAT:  { label: 'immediately (one-time)', doses_per_day: null, interval_hours: null, timing_slots: ['Immediately as directed'] },
  PRN:   { label: 'as needed',             doses_per_day: null, interval_hours: null, timing_slots: ['When needed — see condition below'] },
};

// ─── Timing / Administration Context Dictionary ───────────────────────────────
// AC = ante cibum, PC = post cibum, etc.

const TIMING_DICT = {
  AC:    { label: 'before meals',      instruction: 'Take 30 minutes before eating.' },
  PC:    { label: 'after meals',       instruction: 'Take immediately after meals.' },
  CC:    { label: 'with meals',        instruction: 'Take during meals.' },
  HS:    { label: 'at bedtime',        instruction: 'Take at bedtime (9–10 PM).' },
  STAT:  { label: 'immediately',       instruction: 'Take right now without delay.' },
  IC:    { label: 'between meals',     instruction: 'Take between meals, not within 1 hour of eating.' },
  AM:    { label: 'morning',           instruction: 'Take in the morning.' },
  PM:    { label: 'evening',           instruction: 'Take in the evening.' },
  ANTE:  { label: 'before',            instruction: 'Take before the specified activity.' },
  POST:  { label: 'after',             instruction: 'Take after the specified activity.' },
};

// ─── Route of Administration Dictionary ──────────────────────────────────────

const ROUTE_DICT = {
  PO:    { label: 'by mouth (oral)',           patient_label: 'Swallow' },
  SL:    { label: 'sublingual',                patient_label: 'Place under the tongue' },
  PR:    { label: 'rectal (suppository)',       patient_label: 'Insert rectally as directed' },
  TOP:   { label: 'topical',                   patient_label: 'Apply to skin' },
  TD:    { label: 'transdermal (patch)',        patient_label: 'Apply patch to skin' },
  INH:   { label: 'inhaled',                   patient_label: 'Inhale as directed' },
  NAS:   { label: 'nasal',                     patient_label: 'Spray into nostril(s)' },
  IV:    { label: 'intravenous',               patient_label: 'Administered by healthcare provider (IV)' },
  IM:    { label: 'intramuscular',             patient_label: 'Administered by healthcare provider (injection)' },
  SC:    { label: 'subcutaneous',              patient_label: 'Subcutaneous injection' },
  OPH:   { label: 'ophthalmic (eye drops)',    patient_label: 'Apply to eye(s) as directed' },
  OTIC:  { label: 'otic (ear drops)',           patient_label: 'Apply to ear(s) as directed' },
};

// ─── Duration Parser ──────────────────────────────────────────────────────────
// Extracts duration from common formats: "30d", "x30", "for 2 weeks", "14 days"

const DURATION_PATTERNS = [
  { regex: /\bx\s*(\d+)\s*d(?:ays?)?\b/i,                    unit: 'days',  multiplier: 1     },
  { regex: /\b(\d+)\s*d(?:ays?)?\b/i,                         unit: 'days',  multiplier: 1     },
  { regex: /\bfor\s+(\d+)\s*d(?:ays?)?\b/i,                   unit: 'days',  multiplier: 1     },
  { regex: /\b(\d+)\s*w(?:eeks?)?\b/i,                        unit: 'weeks', multiplier: 7     },
  { regex: /\bfor\s+(\d+)\s*w(?:eeks?)?\b/i,                  unit: 'weeks', multiplier: 7     },
  { regex: /\b(\d+)\s*m(?:onths?)?\b/i,                       unit: 'months', multiplier: 30   },
  { regex: /\buntil\s+finished\b/i,                            fixed: 'until finished'           },
  { regex: /\bcontinue\s+until\s+review\b/i,                   fixed: 'until reviewed by doctor' },
];

// ─── PRN Condition Patterns ───────────────────────────────────────────────────
// Extract conditional trigger from sigs like "PRN pain", "PRN fever >101°F"

const PRN_CONDITION_PATTERNS = [
  /\bPRN\s+(?:for\s+)?(.+?)(?:\s+(?:max|not|do not|\d+)|$)/i,
  /\bas\s+needed\s+(?:for\s+)?(.+?)(?:\s+(?:max|not|\d+)|$)/i,
  /\bfor\s+(pain|fever|nausea|vomiting|anxiety|insomnia|cough|itching|spasm|diarrhea|constipation)\b/i,
];

// ─── Maximum Daily Dose Reference ─────────────────────────────────────────────
// Common drugs with known hard ceiling. Used to flag when qty × freq exceeds safe limit.
// Values are conservative WHO/FDA ceiling doses per 24 hours.

const MAX_DAILY_DOSE_DB = {
  'paracetamol':    { max_mg: 4000,  note: 'Do not exceed 4g/day (1g/dose, max 4 doses)' },
  'acetaminophen':  { max_mg: 4000,  note: 'Do not exceed 4g/day' },
  'ibuprofen':      { max_mg: 3200,  note: 'Do not exceed 3200mg/day (800mg/dose)' },
  'aspirin':        { max_mg: 4000,  note: 'Analgesic max 4g/day; antiplatelet dose 75–100mg/day is different' },
  'metformin':      { max_mg: 3000,  note: 'Standard max 2550mg/day; extended-release max 2000mg/day' },
  'amoxicillin':    { max_mg: 3000,  note: 'Severe infections max 3g/day' },
  'omeprazole':     { max_mg: 80,    note: 'Max 80mg/day (severe GERD protocols)' },
  'amlodipine':     { max_mg: 10,    note: 'Max 10mg/day' },
  'atorvastatin':   { max_mg: 80,    note: 'Max 80mg/day' },
  'metoprolol':     { max_mg: 400,   note: 'Max 400mg/day (hypertension)' },
  'cetirizine':     { max_mg: 10,    note: 'Max 10mg/day in adults' },
  'diclofenac':     { max_mg: 150,   note: 'Max 150mg/day' },
  'tramadol':       { max_mg: 400,   note: 'Max 400mg/day; reduce in elderly/renal impairment' },
  'pantoprazole':   { max_mg: 80,    note: 'Max 80mg/day' },
};

// ─── Slot Timing Details ──────────────────────────────────────────────────────
// Human-friendly time descriptions and meal context for each slot name.

const SLOT_DETAILS = {
  'Morning':           { time: '7:00–8:00 AM',  meal_context: 'after breakfast' },
  'Midday':            { time: '12:00–1:00 PM', meal_context: 'after lunch' },
  'Afternoon':         { time: '3:00–4:00 PM',  meal_context: 'with afternoon snack' },
  'Evening':           { time: '6:00–7:00 PM',  meal_context: 'before dinner' },
  'Night':             { time: '9:00–10:00 PM', meal_context: 'after dinner' },
  'Bedtime (9–10 PM)': { time: '9:00–10:00 PM', meal_context: 'at least 2 hours after last meal' },
};

// ─── Utility: Normalise Sig Token ─────────────────────────────────────────────

/**
 * Normalises a raw sig token to uppercase with no surrounding whitespace.
 * Handles common punctuation variations: "b.i.d." → "BID", "q.d" → "QD".
 * @param {string} token
 * @returns {string}
 */
function normaliseToken(token) {
  return token
    .toUpperCase()
    .replace(/\./g, '')     // Remove dots: b.i.d. → BID
    .replace(/\s+/g, '')    // Collapse whitespace
    .trim();
}

// ─── Core Parser ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ParsedSig
 * @property {string}   raw_sig             - Original unparsed sig string
 * @property {string|null} quantity         - e.g., "1 tablet", "5 mL"
 * @property {string|null} frequency_code   - Normalised frequency: "BID", "TID" etc.
 * @property {string|null} timing_code      - e.g., "AC", "PC", "HS"
 * @property {string|null} route_code       - e.g., "PO", "IV"
 * @property {number|null} duration_days    - Numeric days; null if not parseable
 * @property {string|null} duration_text    - Human readable duration
 * @property {boolean}     is_prn           - True if sig contains PRN
 * @property {string|null} prn_condition    - Extracted condition text
 * @property {string[]}    unparsed_tokens  - Any tokens not matched by dictionary
 */

/**
 * Parses a raw prescription sig string into structured components.
 * @param {string} rawSig
 * @returns {ParsedSig}
 */
function parseSig(rawSig) {
  if (!rawSig || typeof rawSig !== 'string') {
    return _emptyParsed(rawSig || '');
  }

  const result = {
    raw_sig: rawSig,
    quantity: null,
    frequency_code: null,
    timing_code: null,
    route_code: null,
    duration_days: null,
    duration_text: null,
    is_prn: false,
    prn_condition: null,
    unparsed_tokens: [],
  };

  // ── Step 1: PRN detection (must run before tokenisation) ─────────────────
  const prnMatch = rawSig.match(/\bPRN\b|\bas\s+needed\b/i);
  if (prnMatch) {
    result.is_prn = true;
    for (const pattern of PRN_CONDITION_PATTERNS) {
      const m = rawSig.match(pattern);
      if (m && m[1]) {
        result.prn_condition = m[1].trim().toLowerCase();
        break;
      }
    }
    if (!result.prn_condition) {
      result.prn_condition = 'as directed by your doctor';
    }
  }

  // ── Step 2: Duration extraction ──────────────────────────────────────────
  for (const dp of DURATION_PATTERNS) {
    if (dp.fixed) {
      if (dp.regex.test(rawSig)) {
        result.duration_days = null;
        result.duration_text = dp.fixed;
        break;
      }
    } else {
      const m = rawSig.match(dp.regex);
      if (m) {
        const quantity = parseInt(m[1], 10);
        result.duration_days = quantity * dp.multiplier;
        result.duration_text = `${quantity} ${dp.unit}`;
        break;
      }
    }
  }

  // ── Step 3: Quantity extraction ──────────────────────────────────────────
  // Matches: "1 tab", "2 tablets", "5ml", "1 cap", "one tablet", "½ tablet"
  const qtyMatch = rawSig.match(
    /\b(½|\d+(?:\.\d+)?)\s*(tab(?:lets?)?|cap(?:sules?)?|ml|mg|mL|drops?|puffs?|spray|suppository|patch|sachet|unit)\b/i
  );
  if (qtyMatch) {
    const qty = qtyMatch[1] === '½' ? '0.5' : qtyMatch[1];
    result.quantity = `${qty} ${qtyMatch[2].toLowerCase()}`;
  }

  // ── Step 4: Tokenise remaining string for freq / timing / route ──────────
  // Split on spaces, commas, slashes, dashes (preserve alphanumeric clusters)
  const tokens = rawSig
    .split(/[\s,;/\-]+/)
    .map(t => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const norm = normaliseToken(token);

    if (!result.frequency_code && FREQUENCY_DICT[norm]) {
      result.frequency_code = norm;
      continue;
    }
    if (!result.timing_code && TIMING_DICT[norm]) {
      result.timing_code = norm;
      continue;
    }
    if (!result.route_code && ROUTE_DICT[norm]) {
      result.route_code = norm;
      continue;
    }

    // Skip already-resolved tokens: qty digits, duration text, PRN
    const isKnownToken =
      /^\d+(?:\.\d+)?$/.test(token) ||
      /^(tab|cap|ml|mg|drops?|puffs?|spray|patch|sachet|unit|for|x|days?|weeks?|months?|prn|as|needed|stat|now)$/i.test(token);
    if (!isKnownToken) {
      result.unparsed_tokens.push(token);
    }
  }

  return result;
}

// ─── Schedule Generator ───────────────────────────────────────────────────────

/**
 * @typedef {Object} DoseSlot
 * @property {string}  slot         - Slot label: "Morning", "Night" etc.
 * @property {string}  time_window  - Human clock window: "7:00–8:00 AM"
 * @property {string}  instruction  - Full patient-friendly dose instruction
 */

/**
 * @typedef {Object} TranslatedSchedule
 * @property {string}       summary          - One-line plain English schedule summary
 * @property {DoseSlot[]}   dose_slots       - Individual dose event objects
 * @property {boolean}      is_prn           - Whether this is an as-needed medication
 * @property {string|null}  prn_condition    - What condition triggers the PRN dose
 * @property {string|null}  timing_instruction - Meal relationship instruction
 * @property {string|null}  route_label      - Patient-readable route label
 * @property {string|null}  duration_text    - How long to take the medication
 * @property {number|null}  duration_days    - Numeric duration in days
 * @property {string|null}  max_daily_dose   - Safety ceiling note if known drug
 * @property {boolean}      has_unparsed     - True if some tokens were not recognised
 * @property {string[]}     unparsed_tokens  - Unrecognised sig tokens (for pharmacist review)
 */

/**
 * Generates a structured, patient-friendly medication schedule from a parsed sig.
 *
 * @param {ParsedSig} parsed
 * @param {string} drugName  - Drug name (used for max-dose DB lookup)
 * @param {string} [dosageStrength]
 * @returns {TranslatedSchedule}
 */
function generateSchedule(parsed, drugName = '', dosageStrength = '') {
  const freq = FREQUENCY_DICT[parsed.frequency_code] || null;
  const timing = TIMING_DICT[parsed.timing_code] || null;
  const route = ROUTE_DICT[parsed.route_code] || null;

  const quantity = parsed.quantity || '1 dose';
  const routeLabel = route ? route.patient_label : 'Take';
  const timingInstruction = timing ? timing.instruction : null;

  // Build dose slot array
  const doseSlots = [];

  if (parsed.is_prn) {
    // PRN: single "when needed" slot
    doseSlots.push({
      slot: 'As Needed',
      time_window: 'When required',
      instruction: _buildDoseInstruction(
        routeLabel,
        quantity,
        `as needed for ${parsed.prn_condition}`,
        timingInstruction
      ),
    });
  } else if (freq && freq.timing_slots) {
    // Fixed schedule: one slot per dose event
    for (const slotName of freq.timing_slots) {
      const slotDetail = SLOT_DETAILS[slotName] || { time: slotName, meal_context: null };
      const mealContext = timing
        ? timing.label
        : slotDetail.meal_context;

      doseSlots.push({
        slot: slotName,
        time_window: slotDetail.time,
        instruction: _buildDoseInstruction(
          routeLabel,
          quantity,
          slotName,
          timingInstruction || (mealContext ? `Take ${mealContext}.` : null)
        ),
      });
    }
  } else if (parsed.frequency_code === 'STAT') {
    doseSlots.push({
      slot: 'Immediately',
      time_window: 'Right now',
      instruction: `${routeLabel} ${quantity} immediately as directed by your healthcare provider.`,
    });
  }

  // Summary sentence
  let summary;
  if (parsed.is_prn) {
    summary = `${routeLabel} ${quantity} as needed for ${parsed.prn_condition}.`;
  } else if (freq) {
    summary = `${routeLabel} ${quantity} ${freq.label}${timing ? ' ' + timing.label : ''}${parsed.duration_text ? ' for ' + parsed.duration_text : ''}.`;
  } else {
    summary = `${routeLabel} ${quantity} as directed.`;
  }

  // Max daily dose lookup
  let maxDailyDose = null;
  const drugKey = drugName.toLowerCase().split(' ')[0];
  const doseEntry = MAX_DAILY_DOSE_DB[drugKey];
  if (doseEntry) {
    maxDailyDose = doseEntry.note;
  }

  return {
    summary,
    dose_slots: doseSlots,
    is_prn: parsed.is_prn,
    prn_condition: parsed.prn_condition,
    timing_instruction: timingInstruction,
    route_label: route ? route.label : null,
    duration_text: parsed.duration_text,
    duration_days: parsed.duration_days,
    max_daily_dose: maxDailyDose,
    has_unparsed: parsed.unparsed_tokens.length > 0,
    unparsed_tokens: parsed.unparsed_tokens,
  };
}

/**
 * @private
 * Builds a single-dose instruction string.
 */
function _buildDoseInstruction(routeLabel, quantity, slot, timingNote) {
  let instruction = `${routeLabel} ${quantity} — ${slot}.`;
  if (timingNote) {
    instruction += ` ${timingNote}`;
  }
  return instruction;
}

/**
 * @private
 * Returns a blank ParsedSig for null/empty input.
 */
function _emptyParsed(raw) {
  return {
    raw_sig: raw,
    quantity: null,
    frequency_code: null,
    timing_code: null,
    route_code: null,
    duration_days: null,
    duration_text: null,
    is_prn: false,
    prn_condition: null,
    unparsed_tokens: [],
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Translates a raw prescription sig string into a structured patient-friendly schedule.
 *
 * This is the primary entry point used by API route handlers.
 *
 * @param {string} rawSig           - e.g., "1 tab BID PC x 30d"
 * @param {string} [drugName='']    - Drug name for max-dose lookup
 * @param {string} [dosageStrength=''] - e.g., "500mg"
 * @returns {{ parsed: ParsedSig, schedule: TranslatedSchedule }}
 */
export function translateSig(rawSig, drugName = '', dosageStrength = '') {
  const parsed = parseSig(rawSig);
  const schedule = generateSchedule(parsed, drugName, dosageStrength);
  return { parsed, schedule };
}

/**
 * Translates an array of medication item objects (as stored in ClinicalNote.medications).
 * Useful for bulk prescription rendering in PatientMode.
 *
 * @param {Array<{ drugName: string, dosage: string, frequency: string, duration: string, sig?: string }>} medications
 * @returns {Array<{ drug: string, dosage: string, parsed: ParsedSig, schedule: TranslatedSchedule }>}
 */
export function translateMedicationList(medications) {
  if (!Array.isArray(medications)) return [];
  return medications.map((med) => {
    // Prefer explicit sig field; fall back to reconstructing from frequency/duration
    const rawSig = med.sig || [med.frequency, med.duration].filter(Boolean).join(' ');
    const { parsed, schedule } = translateSig(rawSig, med.drugName || '', med.dosage || '');
    return {
      drug: med.drugName || 'Unknown Drug',
      dosage: med.dosage || '',
      parsed,
      schedule,
    };
  });
}

/**
 * Checks whether a parsed sig is potentially dangerous due to unclear/unparsed tokens.
 * Returns true if pharmacist manual review is recommended.
 *
 * @param {ParsedSig} parsed
 * @returns {{ needs_review: boolean, reasons: string[] }}
 */
export function flagForPharmacistReview(parsed) {
  const reasons = [];
  if (parsed.unparsed_tokens.length > 0) {
    reasons.push(`Unrecognised sig tokens: [${parsed.unparsed_tokens.join(', ')}]`);
  }
  if (!parsed.frequency_code && !parsed.is_prn) {
    reasons.push('No dosing frequency identified — schedule cannot be determined.');
  }
  if (!parsed.route_code) {
    reasons.push('Route of administration not specified — confirm PO/IV/TOP etc. with prescribing doctor.');
  }
  if (parsed.is_prn && !parsed.prn_condition) {
    reasons.push('PRN condition not specified — patient cannot determine when to take this medication.');
  }
  return {
    needs_review: reasons.length > 0,
    reasons,
  };
}

/**
 * Returns a minimal human-readable summary for display in UI chips/badges.
 * e.g., "1 tab · Twice Daily · After meals · 30 days"
 *
 * @param {TranslatedSchedule} schedule
 * @returns {string}
 */
export function formatScheduleBadge(schedule) {
  const parts = [];
  if (schedule.dose_slots[0]?.instruction) {
    parts.push(schedule.summary);
  } else {
    parts.push('As directed');
  }
  if (schedule.duration_text) parts.push(schedule.duration_text);
  if (schedule.timing_instruction) parts.push(schedule.timing_instruction);
  return parts.join(' · ');
}

export const SigTranslatorService = {
  translateSig,
  translateMedicationList,
  flagForPharmacistReview,
  formatScheduleBadge,
  // Expose dictionaries for testing / pharmacist UI override
  FREQUENCY_DICT,
  TIMING_DICT,
  ROUTE_DICT,
};

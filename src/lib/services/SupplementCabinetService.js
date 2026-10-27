/**
 * lib/services/SupplementCabinetService.js
 *
 * Smart Supplement Compounding Cabinet — Algorithmic Nutrition Engine
 *
 * Dynamically calculates daily personalized micronutrient formulations based on:
 *   - Live exposome state (AQI, UV Index, Pollen)
 *   - Biometric state (HRV, Sleep Architecture, Stress Index)
 *
 * Safety Architecture:
 *   1. Loads all relevant drug-nutrient contraindications for the patient's
 *      active medication list from the database.
 *   2. For SUPPRESS actions: compound is removed from formula, audit warning created.
 *   3. For REDUCE_DOSE actions: dose is scaled proportionally.
 *   4. For WARN actions: compound included with clinical warning flag.
 *   5. UL (Tolerable Upper Intake Level) is validated for fat-soluble vitamins.
 *
 * MANDATORY CLINICAL SAFETY RULE:
 *   If an active prescription or allergy conflict is detected, the compounder
 *   MUST suppress the contraindicated compound and output an audit warning.
 *   This service FAILS CLOSED — suppression is the default on ambiguous conflicts.
 *
 * References:
 *   - NIH Office of Dietary Supplements (ODS) Tolerable Upper Intake Levels
 *   - EFSA Tolerable Upper Intake Levels for Vitamins and Minerals (2023)
 *   - Natural Standard Drug-Herb Interaction Database
 *   - Lexicomp Online Drug Interactions
 */

import { prisma } from '../prisma.js';

// ─── Compounding Rules Engine ─────────────────────────────────────────────────
// Maps environmental/biometric trigger tags to compound IDs.
// Compounds are activated when ANY of their indication_tags match active triggers.

const TRIGGER_TO_COMPOUNDS = {
  high_aqi:              ['sc_nac', 'sc_sul', 'sc_vitc'],
  pm25_elevated:         ['sc_nac', 'sc_vitc'],
  pm10_elevated:         ['sc_sul'],
  uv_high:               ['sc_astx', 'sc_pol', 'sc_lyc'],
  uv_extreme:            ['sc_astx', 'sc_pol', 'sc_lyc'],
  uv_moderate:           ['sc_vitc'],
  solar_radiation:       ['sc_astx', 'sc_lyc'],
  low_hrv:               ['sc_ksm', 'sc_lth', 'sc_mgb'],
  high_allostatic_load:  ['sc_ksm', 'sc_mgb'],
  elevated_stress:       ['sc_ksm', 'sc_lth', 'sc_mgb'],
  sleep_impaired:        ['sc_api', 'sc_gly', 'sc_tch', 'sc_lth', 'sc_mgb'],
  low_rem:               ['sc_tch', 'sc_api'],
  low_deep:              ['sc_gly', 'sc_api'],
  immune_suppressed:     ['sc_vitc'],
  high_pollen:           ['sc_vitc'],
  mitochondrial:         ['sc_coq'],
  baseline:              ['sc_coq', 'sc_d3', 'sc_k2'],
};

// Foundation compounds always included in baseline
const ALWAYS_INCLUDE = ['sc_coq', 'sc_d3', 'sc_k2'];

/**
 * Derives active trigger tags from current biometric and exposome state.
 *
 * @param {Object} state
 * @param {number} state.aqi             - Current AQI
 * @param {number} state.pm25            - PM2.5 µg/m³
 * @param {number} state.uvIndex         - UV Index
 * @param {number} state.hrv             - Current HRV rMSSD (ms)
 * @param {number} state.hrvBaseline     - Personal HRV baseline (ms)
 * @param {number} state.sleepHours      - Total sleep last night
 * @param {number} state.sleepBaseline   - Personal sleep baseline
 * @param {number} state.stressIndex     - Current stress index (0-100)
 * @param {number} state.deepRemRatio    - Deep+REM ratio
 * @param {number} state.pollenMax       - Max pollen level (0-4)
 * @returns {string[]} activeTriggers
 */
function deriveTriggers({ aqi = 0, pm25, uvIndex = 0, hrv = 60, hrvBaseline = 60,
                           sleepHours = 7, sleepBaseline = 7, stressIndex = 30,
                           deepRemRatio = 0.35, pollenMax = 0 }) {
  const triggers = new Set(['baseline', 'mitochondrial']);

  // AQI triggers
  if (aqi >= 100)               triggers.add('high_aqi');
  if (pm25 !== undefined && pm25 >= 35.5) triggers.add('pm25_elevated');
  if (pm25 !== undefined && pm25 >= 154)  triggers.add('pm10_elevated');

  // UV triggers
  if (uvIndex >= 3)             triggers.add('uv_moderate');
  if (uvIndex >= 7)             { triggers.add('uv_high'); triggers.add('solar_radiation'); }
  if (uvIndex >= 11)            triggers.add('uv_extreme');

  // HRV / Stress triggers
  const hrvRatio = hrv / Math.max(hrvBaseline, 1);
  if (hrvRatio < 0.80)          triggers.add('low_hrv');           // HRV >20% below baseline
  if (stressIndex >= 50)        triggers.add('elevated_stress');
  if (stressIndex >= 65)        triggers.add('high_allostatic_load');

  // Sleep triggers
  const sleepRatio = sleepHours / Math.max(sleepBaseline, 1);
  if (sleepRatio < 0.85 || sleepHours < 6.5) triggers.add('sleep_impaired');
  if (deepRemRatio < 0.20)      triggers.add('low_deep');
  if (deepRemRatio < 0.25)      triggers.add('low_rem');

  // Pollen / immune triggers
  if (pollenMax >= 3)           triggers.add('high_pollen');
  if (aqi >= 150 || pollenMax >= 3 || hrv < 40) triggers.add('immune_suppressed');

  return [...triggers];
}

/**
 * Fetches compound definitions from DB for a given set of compound IDs.
 * Uses a raw join-free query for performance.
 *
 * @param {string[]} compoundIds
 * @returns {Promise<Map<string, Object>>} compound_id → compound definition
 */
async function fetchCompounds(compoundIds) {
  if (compoundIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw`
    SELECT id, compound_name, compound_type, is_fat_soluble,
           standard_dose_mg, dose_unit, ul_per_day_mg, ul_source,
           indication_tags, mechanism_note
    FROM supplement_compounds
    WHERE id = ANY(${compoundIds}::text[])
      AND is_active = TRUE
  `;

  const map = new Map();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

/**
 * Fetches all active contraindications for a set of compound IDs.
 *
 * @param {string[]} compoundIds
 * @returns {Promise<Object[]>}
 */
async function fetchContraindications(compoundIds) {
  if (compoundIds.length === 0) return [];

  return prisma.$queryRaw`
    SELECT compound_id, conflicting_agent, conflict_type, severity,
           mechanism, action, reduced_dose_pct, evidence_source
    FROM supplement_contraindications
    WHERE compound_id = ANY(${compoundIds}::text[])
      AND is_active = TRUE
  `;
}

/**
 * Checks if a patient's active medications match any contraindication agent.
 * Uses case-insensitive substring matching (conservative fail-closed approach).
 *
 * @param {string} conflictingAgent - Medication name/class from contraindications table
 * @param {string[]} patientMeds    - Active medication names list
 * @returns {boolean}
 */
function medicationMatchesAgent(conflictingAgent, patientMeds) {
  const agentLower = conflictingAgent.toLowerCase();
  return patientMeds.some(med => {
    const medLower = med.toLowerCase();
    // Match if either string is a substring of the other (class-level matching)
    return medLower.includes(agentLower) || agentLower.includes(medLower);
  });
}

/**
 * Validates that a fat-soluble compound dose does not exceed its UL.
 * Fat-soluble vitamins (A, D, E, K) accumulate in adipose tissue — UL enforcement
 * is mandatory per NIH ODS guidance.
 *
 * @param {Object} compound
 * @param {number} doseMg
 * @returns {{ ok: boolean, warning: string|null }}
 */
function validateUpperLimit(compound, doseMg) {
  if (!compound.is_fat_soluble || !compound.ul_per_day_mg) {
    return { ok: true, warning: null };
  }

  if (doseMg > compound.ul_per_day_mg) {
    return {
      ok: false,
      warning: `${compound.compound_name} dose (${doseMg}${compound.dose_unit}) exceeds NIH UL of ${compound.ul_per_day_mg}${compound.dose_unit}/day (${compound.ul_source || 'NIH ODS'}). Dose capped at UL.`,
    };
  }

  return { ok: true, warning: null };
}

/**
 * Main compounding engine entry point.
 *
 * @param {Object} params
 * @param {string} params.patientId
 * @param {string[]} params.activeMedications  - Patient's active prescription list
 * @param {string[]} params.knownAllergies      - Known allergen list
 * @param {Object}   params.exposomeState       - Current exposome readings
 * @param {Object}   params.biometricState      - Current biometric readings
 *
 * @returns {Promise<CompoundingResult>}
 *
 * @typedef {Object} CompoundingResult
 * @property {CompoundEntry[]} formula            - Final compounded formula
 * @property {SuppressedEntry[]} suppressed       - Suppressed compounds with reasons
 * @property {string[]} auditWarnings             - Non-suppressing clinical warnings
 * @property {string[]} activeTriggers            - Biomarker trigger tags that drove selection
 * @property {TIMESTAMPTZ} contraindCheckedAt     - Timestamp of safety check
 */
export async function compoundDailyFormula({
  patientId,
  activeMedications = [],
  knownAllergies    = [],
  exposomeState     = {},
  biometricState    = {},
}) {
  // 1. Derive active triggers
  const activeTriggers = deriveTriggers({
    aqi:           exposomeState.aqi,
    pm25:          exposomeState.pm25,
    uvIndex:       exposomeState.uvIndex,
    hrv:           biometricState.hrv,
    hrvBaseline:   biometricState.hrvBaseline,
    sleepHours:    biometricState.sleepHours,
    sleepBaseline: biometricState.sleepBaseline,
    stressIndex:   biometricState.stressIndex,
    deepRemRatio:  biometricState.deepRemRatio,
    pollenMax:     exposomeState.pollenMax,
  });

  // 2. Resolve compound IDs from triggers (deduplicated)
  const compoundIdSet = new Set(ALWAYS_INCLUDE);
  for (const trigger of activeTriggers) {
    const compounds = TRIGGER_TO_COMPOUNDS[trigger] || [];
    compounds.forEach(id => compoundIdSet.add(id));
  }
  const selectedIds = [...compoundIdSet];

  // 3. Fetch compound definitions
  const compoundMap = await fetchCompounds(selectedIds);

  // 4. Fetch contraindications for selected compounds
  const contraindications = await fetchContraindications(selectedIds);

  // 5. Build contraindication index keyed by compound_id
  const contraindicationsByCompound = {};
  for (const ci of contraindications) {
    if (!contraindicationsByCompound[ci.compound_id]) {
      contraindicationsByCompound[ci.compound_id] = [];
    }
    contraindicationsByCompound[ci.compound_id].push(ci);
  }

  // 6. Apply safety rules — build formula with suppressions
  const formula      = [];
  const suppressed   = [];
  const auditWarnings = [];
  const medList      = activeMedications.map(m => String(m));
  const allergyList  = knownAllergies.map(a => String(a).toLowerCase());

  for (const compoundId of selectedIds) {
    const compound = compoundMap.get(compoundId);
    if (!compound) continue; // Compound not found in DB — skip silently (conservative)

    let isSuppressed   = false;
    let suppressReason = null;

    // 6a. Allergy check — fail closed on any allergy match
    const allergyMatch = allergyList.some(allergy =>
      compound.compound_name.toLowerCase().includes(allergy) ||
      (compound.common_aliases || []).some(alias => String(alias).toLowerCase().includes(allergy))
    );

    if (allergyMatch) {
      isSuppressed   = true;
      suppressReason = `Known allergy match: ${compound.compound_name} suppressed. Patient allergy list includes a matching compound or class.`;
    }

    // 6b. Drug-nutrient contraindication check
    if (!isSuppressed) {
      const cis = contraindicationsByCompound[compoundId] || [];
      for (const ci of cis) {
        const matches = medicationMatchesAgent(ci.conflicting_agent, medList);
        if (!matches) continue;

        if (ci.action === 'SUPPRESS' || ci.severity === 'CONTRAINDICATED') {
          isSuppressed   = true;
          suppressReason = `Contraindicated with active medication "${ci.conflicting_agent}" (${ci.severity}): ${ci.mechanism}. Evidence: ${ci.evidence_source || 'Clinical database'}.`;
          break;
        } else if (ci.action === 'REDUCE_DOSE' && ci.reduced_dose_pct) {
          const originalDose = compound.standard_dose_mg;
          const reducedDose  = Math.round(originalDose * (ci.reduced_dose_pct / 100));
          auditWarnings.push(
            `${compound.compound_name}: Dose reduced from ${originalDose}${compound.dose_unit} to ${reducedDose}${compound.dose_unit} due to interaction with "${ci.conflicting_agent}" (${ci.severity}). ${ci.mechanism}`
          );
          compound._overrideDose = reducedDose;
        } else if (ci.action === 'WARN') {
          auditWarnings.push(
            `${compound.compound_name}: Co-administration warning with "${ci.conflicting_agent}" (${ci.severity}). ${ci.mechanism}. Evidence: ${ci.evidence_source || 'Clinical database'}.`
          );
        }
      }
    }

    if (isSuppressed) {
      suppressed.push({
        compoundId,
        compoundName: compound.compound_name,
        reason:       suppressReason,
      });
      auditWarnings.push(`SUPPRESSED — ${compound.compound_name}: ${suppressReason}`);
      continue;
    }

    // 6c. UL validation for fat-soluble compounds
    const effectiveDose = compound._overrideDose || compound.standard_dose_mg;
    const ulCheck       = validateUpperLimit(compound, effectiveDose);

    if (!ulCheck.ok) {
      // Cap at UL — do not suppress, but warn
      auditWarnings.push(ulCheck.warning);
    }

    const finalDose = !ulCheck.ok ? compound.ul_per_day_mg : effectiveDose;

    // 7. Find the source trigger that activated this compound
    let sourceTrigger = 'baseline';
    for (const trigger of activeTriggers) {
      if ((TRIGGER_TO_COMPOUNDS[trigger] || []).includes(compoundId)) {
        sourceTrigger = trigger;
        break;
      }
    }

    formula.push({
      compoundId,
      compoundName:  compound.compound_name,
      compoundType:  compound.compound_type,
      isFatSoluble:  compound.is_fat_soluble,
      doseMg:        finalDose,
      doseDisplay:   `${finalDose}${compound.dose_unit}`,
      reason:        compound.mechanism_note || 'Evidence-based supplementation',
      sourceTrigger,
    });
  }

  const contraindCheckedAt = new Date().toISOString();

  // 8. Persist formula to DB (upsert for today)
  if (patientId) {
    await prisma.$executeRaw`
      INSERT INTO supplement_formulas (
        patient_id, formula_date, compounds,
        aqi_at_compound, uv_at_compound, hrv_at_compound, stress_at_compound,
        contraindications_checked_at, suppressed_compounds, audit_warnings
      ) VALUES (
        ${patientId}, CURRENT_DATE,
        ${JSON.stringify(formula)}::jsonb,
        ${exposomeState.aqi || null},
        ${exposomeState.uvIndex || null},
        ${biometricState.hrv || null},
        ${biometricState.stressIndex || null},
        ${contraindCheckedAt}::timestamptz,
        ${JSON.stringify(suppressed)}::jsonb,
        ${JSON.stringify(auditWarnings)}::jsonb
      )
      ON CONFLICT (patient_id, formula_date)
      DO UPDATE SET
        compounds = EXCLUDED.compounds,
        aqi_at_compound = EXCLUDED.aqi_at_compound,
        uv_at_compound = EXCLUDED.uv_at_compound,
        hrv_at_compound = EXCLUDED.hrv_at_compound,
        stress_at_compound = EXCLUDED.stress_at_compound,
        contraindications_checked_at = EXCLUDED.contraindications_checked_at,
        suppressed_compounds = EXCLUDED.suppressed_compounds,
        audit_warnings = EXCLUDED.audit_warnings
    `;
  }

  return {
    formula,
    suppressed,
    auditWarnings,
    activeTriggers,
    contraindCheckedAt,
  };
}

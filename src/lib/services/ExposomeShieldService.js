/**
 * lib/services/ExposomeShieldService.js
 *
 * Exposome Shield Engine
 *
 * Ingests geolocation-derived environmental telemetry and computes:
 *   1. Composite Environmental Stress Score (0–100)
 *   2. Deterministic, climate-adaptive mitigation protocols
 *
 * Scoring Model:
 *   - AQI subscore (35% weight): EPA AQI breakpoints mapped to 0-100 stress
 *   - UV subscore  (25% weight): WHO UV Index categories mapped to stress
 *   - Pollen subscore (15% weight): composite pollen burden
 *   - Thermal subscore (15% weight): heat index / cold stress deviation
 *   - Humidity subscore (10% weight): extreme humidity deviation
 *
 * References:
 *   - EPA AQI Breakpoints: 40 CFR Part 58 Appendix G
 *   - WHO UV Index: World Health Organization (2002) Global Solar UV Index
 *   - NIOSH Heat Stress Standards: OSHA 3154
 *   - American Academy of Allergy, Asthma & Immunology (AAAAI) Pollen Index
 */

// ─── AQI Category Mapping ────────────────────────────────────────────────────
// EPA AQI Breakpoints → Stress Score (0-100)
const AQI_STRESS_TABLE = [
  { max: 50,  stress: 5,   label: 'Good' },
  { max: 100, stress: 20,  label: 'Moderate' },
  { max: 150, stress: 40,  label: 'Unhealthy for Sensitive Groups' },
  { max: 200, stress: 60,  label: 'Unhealthy' },
  { max: 300, stress: 80,  label: 'Very Unhealthy' },
  { max: 500, stress: 100, label: 'Hazardous' },
];

// ─── UV Category Mapping ─────────────────────────────────────────────────────
const UV_STRESS_TABLE = [
  { max: 2,  stress: 0,   label: 'Low' },
  { max: 5,  stress: 20,  label: 'Moderate' },
  { max: 7,  stress: 40,  label: 'High' },
  { max: 10, stress: 65,  label: 'Very High' },
  { max: 20, stress: 90,  label: 'Extreme' },
];

// ─── Pollen Level → Stress ───────────────────────────────────────────────────
// Input: 0=None, 1=Low, 2=Moderate, 3=High, 4=Very High
const POLLEN_STRESS_MAP = { 0: 0, 1: 15, 2: 35, 3: 60, 4: 85 };

/**
 * Looks up a stress value from a breakpoint table.
 * @param {number} value - Input value
 * @param {Array<{max: number, stress: number, label: string}>} table
 * @returns {{ stress: number, label: string }}
 */
function lookupStress(value, table) {
  for (const row of table) {
    if (value <= row.max) return { stress: row.stress, label: row.label };
  }
  return { stress: table[table.length - 1].stress, label: table[table.length - 1].label };
}

/**
 * Computes thermal stress deviation from comfort zone (21-26°C).
 * Heat stress: penalty for > 32°C heat index.
 * Cold stress: penalty for < 5°C ambient.
 *
 * @param {number} tempC - Ambient temperature (°C)
 * @param {number} [heatIndexC] - Heat index (°C), falls back to tempC
 * @returns {number} 0–100 thermal stress
 */
function computeThermalStress(tempC, heatIndexC) {
  const effectiveTemp = heatIndexC !== undefined ? heatIndexC : tempC;

  if (effectiveTemp >= 32 && effectiveTemp < 41) return 40;
  if (effectiveTemp >= 41 && effectiveTemp < 46) return 65;
  if (effectiveTemp >= 46) return 90;
  if (effectiveTemp <= 5 && effectiveTemp > 0)  return 30;
  if (effectiveTemp <= 0)                        return 55;
  return 5; // Comfortable range
}

/**
 * Computes humidity stress deviation.
 * Optimal humidity: 40-60%. Extremes (>85% or <20%) cause respiratory strain.
 *
 * @param {number} humidityPct
 * @returns {number} 0–100 humidity stress
 */
function computeHumidityStress(humidityPct) {
  if (humidityPct > 85) return 55;
  if (humidityPct > 70) return 25;
  if (humidityPct < 20) return 40;
  if (humidityPct < 30) return 20;
  return 5; // Comfortable range
}

/**
 * Builds a deterministic list of mitigation protocols based on environmental
 * conditions. Each protocol has: action, reason, priority (1=urgent).
 *
 * @param {Object} params
 * @returns {MitigationProtocol[]}
 *
 * @typedef {Object} MitigationProtocol
 * @property {string}  action      - Actionable directive
 * @property {string}  reason      - Clinical rationale
 * @property {string}  category    - 'UV' | 'AIR' | 'POLLEN' | 'THERMAL' | 'HYDRATION'
 * @property {number}  priority    - 1 (urgent) to 3 (advisory)
 */
function buildMitigationProtocols({ aqiComposite, uvIndex, pm25, pollenTree, pollenGrass, pollenWeed, tempC, humidityPct, heatIndexC }) {
  const protocols = [];

  // AQI / Air Quality Protocols
  if (aqiComposite >= 150) {
    protocols.push({
      action: 'Wear N95/KN95 respirator outdoors. Limit outdoor exposure to <30 min.',
      reason: `AQI ${aqiComposite} — Unhealthy: PM2.5/PM10 at oxidative damage threshold.`,
      category: 'AIR',
      priority: 1,
    });
    protocols.push({
      action: 'Activate HEPA air purifier indoors (CADR ≥ 200 for room size).',
      reason: 'Indoor PM2.5 mitigation required during high-AQI periods.',
      category: 'AIR',
      priority: 1,
    });
  } else if (aqiComposite >= 100) {
    protocols.push({
      action: 'Reduce prolonged vigorous outdoor exercise. Consider indoor training.',
      reason: `AQI ${aqiComposite} — Moderate: increased respiratory particulate load.`,
      category: 'AIR',
      priority: 2,
    });
  }

  if (pm25 !== undefined && pm25 >= 35.5) {
    protocols.push({
      action: 'PM2.5 exposure mitigation: NAC 600mg + Vitamin C 1000mg supplementation.',
      reason: `PM2.5 at ${pm25}µg/m³ — glutathione depletion risk. Antioxidant support recommended.`,
      category: 'AIR',
      priority: 2,
    });
  }

  // UV Protocols
  if (uvIndex >= 11) {
    protocols.push({
      action: 'SPF 50+ broad-spectrum sunscreen required. Reapply every 90 minutes.',
      reason: `UV Index ${uvIndex} (Extreme) — unprotected skin burns in <10 min.`,
      category: 'UV',
      priority: 1,
    });
    protocols.push({
      action: 'Seek shade between 10:00–16:00 local time. Protective clothing recommended.',
      reason: 'Solar UV-B at extreme levels — corneal photokeratitis risk.',
      category: 'UV',
      priority: 1,
    });
  } else if (uvIndex >= 7) {
    protocols.push({
      action: 'Apply SPF 30-50+ barrier cream. UV-protective sunglasses required.',
      reason: `UV Index ${uvIndex} (Very High) — significant erythema risk within 15-25 min.`,
      category: 'UV',
      priority: 2,
    });
  } else if (uvIndex >= 3) {
    protocols.push({
      action: 'Apply SPF 15+ sunscreen if outdoors for >45 minutes.',
      reason: `UV Index ${uvIndex} (Moderate) — cumulative UV dose advisory.`,
      category: 'UV',
      priority: 3,
    });
  }

  // Pollen Protocols
  const maxPollen = Math.max(pollenTree || 0, pollenGrass || 0, pollenWeed || 0);
  if (maxPollen >= 3) {
    const pollenTypes = [];
    if (pollenTree >= 3) pollenTypes.push('tree');
    if (pollenGrass >= 3) pollenTypes.push('grass');
    if (pollenWeed >= 3) pollenTypes.push('weed');
    protocols.push({
      action: `High ${pollenTypes.join('/')} pollen: keep windows closed; shower post-outdoor activity; use HEPA air purifier.`,
      reason: 'Airborne allergen load sufficient to trigger IgE-mediated immune response in sensitized individuals.',
      category: 'POLLEN',
      priority: 2,
    });
    protocols.push({
      action: 'Schedule outdoor activity before 10:00 AM (pollen counts peak mid-day).',
      reason: 'Pollen dispersion peaks 10:00–14:00 in most temperate climates.',
      category: 'POLLEN',
      priority: 2,
    });
  }

  // Thermal Protocols
  const effectiveTemp = heatIndexC !== undefined ? heatIndexC : tempC;
  if (effectiveTemp >= 38) {
    protocols.push({
      action: 'Heat emergency protocol: postpone all outdoor exercise. Hydrate 500ml/hour. Seek air conditioning.',
      reason: `Heat index ${effectiveTemp.toFixed(1)}°C — heat stroke risk threshold exceeded.`,
      category: 'THERMAL',
      priority: 1,
    });
  } else if (effectiveTemp >= 32) {
    protocols.push({
      action: 'Shift outdoor exercise to early morning (<9:00 AM) or post-sunset. Carry water.',
      reason: `Heat index ${effectiveTemp.toFixed(1)}°C — vigorous exercise risk elevated.`,
      category: 'THERMAL',
      priority: 2,
    });
  }

  if (humidityPct < 20) {
    protocols.push({
      action: 'Low humidity: increase daily water intake by 500ml. Use nasal saline spray.',
      reason: `Relative humidity ${humidityPct}% — mucosal drying and increased airway particulate deposition.`,
      category: 'HYDRATION',
      priority: 2,
    });
  } else if (humidityPct > 80) {
    protocols.push({
      action: 'High humidity: monitor for mold. Dehumidifier advised indoors. Watch for heat exhaustion.',
      reason: `RH ${humidityPct}% — mold/dust mite proliferation and impaired sweat-cooling efficiency.`,
      category: 'THERMAL',
      priority: 2,
    });
  }

  // Sort by priority (ascending — most urgent first)
  protocols.sort((a, b) => a.priority - b.priority);

  return protocols;
}

/**
 * Main Exposome Shield computation entry point.
 *
 * @param {Object} params
 * @param {number} params.aqiComposite           - Composite AQI (0-500)
 * @param {number} [params.pm25]                 - PM2.5 µg/m³
 * @param {number} [params.pm10]                 - PM10 µg/m³
 * @param {number} [params.o3Ppb]                - Ozone ppb
 * @param {number} [params.no2Ppb]               - NO2 ppb
 * @param {number} params.uvIndex                - UV Index (0-20)
 * @param {number} [params.pollenTree]           - Tree pollen (0-4)
 * @param {number} [params.pollenGrass]          - Grass pollen (0-4)
 * @param {number} [params.pollenWeed]           - Weed pollen (0-4)
 * @param {number} params.ambientTempC           - Ambient temperature °C
 * @param {number} [params.heatIndexC]           - Heat index °C
 * @param {number} params.humidityPct            - Relative humidity %
 * @param {string} [params.locationLabel]        - Human location label
 *
 * @returns {ExposomeResult}
 *
 * @typedef {Object} ExposomeResult
 * @property {number}              stressScore         - 0–100 composite stress
 * @property {string}              stressCategory      - 'MINIMAL' | 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'
 * @property {Object}              subScores           - Per-domain stress sub-scores
 * @property {MitigationProtocol[]} mitigationProtocols - Ordered mitigation list
 * @property {string[]}            supplementTriggers  - Nutrient trigger tags for SupplementCabinet
 */
export function analyzeExposome({
  aqiComposite = 0,
  pm25,
  pm10,
  o3Ppb,
  no2Ppb,
  uvIndex = 0,
  pollenTree = 0,
  pollenGrass = 0,
  pollenWeed = 0,
  ambientTempC = 22,
  heatIndexC,
  humidityPct = 50,
  locationLabel,
}) {
  // --- Sub-scores ---
  const aqiResult    = lookupStress(aqiComposite, AQI_STRESS_TABLE);
  const uvResult     = lookupStress(uvIndex, UV_STRESS_TABLE);
  const pollenBurden = Math.max(
    POLLEN_STRESS_MAP[pollenTree]  || 0,
    POLLEN_STRESS_MAP[pollenGrass] || 0,
    POLLEN_STRESS_MAP[pollenWeed]  || 0
  );
  const thermalStress  = computeThermalStress(ambientTempC, heatIndexC);
  const humidityStress = computeHumidityStress(humidityPct);

  // --- Weighted Composite Score ---
  const stressScore = Math.round(
    aqiResult.stress    * 0.35 +
    uvResult.stress     * 0.25 +
    pollenBurden        * 0.15 +
    thermalStress       * 0.15 +
    humidityStress      * 0.10
  );

  // --- Stress Category ---
  let stressCategory;
  if (stressScore <= 10)      stressCategory = 'MINIMAL';
  else if (stressScore <= 25) stressCategory = 'LOW';
  else if (stressScore <= 50) stressCategory = 'MODERATE';
  else if (stressScore <= 70) stressCategory = 'HIGH';
  else                         stressCategory = 'SEVERE';

  // --- Supplement Trigger Tags ---
  const supplementTriggers = [];
  if (aqiComposite >= 100)    supplementTriggers.push('high_aqi');
  if (pm25 !== undefined && pm25 >= 35.5) supplementTriggers.push('pm25_elevated');
  if (pm10 !== undefined && pm10 >= 154)  supplementTriggers.push('pm10_elevated');
  if (uvIndex >= 7)           supplementTriggers.push('uv_high');
  if (uvIndex >= 11)          supplementTriggers.push('uv_extreme');
  if (uvIndex >= 3)           supplementTriggers.push('uv_moderate');
  if (pollenTree >= 3 || pollenGrass >= 3 || pollenWeed >= 3) supplementTriggers.push('high_pollen');

  // --- Mitigation Protocols ---
  const mitigationProtocols = buildMitigationProtocols({
    aqiComposite, uvIndex, pm25, pollenTree, pollenGrass, pollenWeed,
    tempC: ambientTempC, humidityPct, heatIndexC,
  });

  return {
    stressScore: Math.min(100, stressScore),
    stressCategory,
    subScores: {
      aqi:      { score: aqiResult.stress,    label: aqiResult.label },
      uv:       { score: uvResult.stress,     label: uvResult.label  },
      pollen:   { score: pollenBurden },
      thermal:  { score: thermalStress },
      humidity: { score: humidityStress },
    },
    mitigationProtocols,
    supplementTriggers,
    locationLabel: locationLabel || 'Unknown',
  };
}

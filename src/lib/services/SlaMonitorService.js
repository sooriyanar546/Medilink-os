/**
 * lib/services/SlaMonitorService.js
 *
 * Hospital Floor SLA (Service Level Agreement) Monitor
 *
 * Evaluates real-time dwell times across all clinical zones:
 *   Triage → Doctor Room → Pharmacy → Cashier Billing
 *
 * SLA Thresholds (configurable per zone):
 *   Triage:   warning at 10 min, breach at 15 min
 *   Doctor:   warning at 20 min, breach at 30 min
 *   Pharmacy: warning at 10 min, breach at 15 min
 *   Cashier:  warning at  8 min, breach at 12 min
 *
 * This module is PURE — no DB access. Feed it pre-fetched queue data.
 * The API controller is responsible for hydration.
 */

/**
 * @typedef {Object} QueueEntry
 * @property {string}    visitId
 * @property {string}    patientId
 * @property {string}    patientName
 * @property {string}    status         - 'WAITING' | 'CONSULTING' | 'COMPLETED'
 * @property {number}    queuePosition
 * @property {string}    doctorId
 * @property {string}    doctorName
 * @property {Date|string} checkInAt    - Visit check-in timestamp
 * @property {Date|string|null} consultedAt - Consultation start timestamp
 * @property {boolean}   vitals         - Whether triage vitals have been captured
 * @property {string|null} pharmacyStatus - 'PENDING' | 'PREPARING' | 'READY' | 'DISPENSED'
 */

/**
 * @typedef {Object} ZoneSlaStatus
 * @property {string}   zone           - Zone identifier ('TRIAGE'|'DOCTOR'|'PHARMACY'|'CASHIER')
 * @property {number}   patientCount   - Number of patients currently in this zone
 * @property {number}   avgDwellMins   - Average dwell time in minutes
 * @property {number}   maxDwellMins   - Maximum dwell time in minutes
 * @property {string}   slaStatus      - 'OK' | 'WARNING' | 'BREACH'
 * @property {string[]} bottleneckVisitIds - Visit IDs that have breached their SLA
 * @property {boolean}  requiresDispatch - Whether floor manager dispatch is recommended
 */

/**
 * @typedef {Object} SlaReport
 * @property {ZoneSlaStatus[]} zones
 * @property {boolean}         hasActiveBreach
 * @property {string[]}        breachSummary       - Human-readable breach messages
 * @property {number}          overallSlaScore     - 0–100 composite SLA health score
 * @property {Date}            evaluatedAt
 */

const ZONE_THRESHOLDS = {
  TRIAGE: { warningMins: 10, breachMins: 15 },
  DOCTOR: { warningMins: 20, breachMins: 30 },
  PHARMACY: { warningMins: 10, breachMins: 15 },
  CASHIER: { warningMins: 8, breachMins: 12 },
};

/**
 * Returns elapsed minutes between a past timestamp and now.
 * @param {Date|string} timestamp
 * @returns {number}
 */
function elapsedMins(timestamp) {
  if (!timestamp) return 0;
  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Math.max(0, (Date.now() - ts.getTime()) / 60_000);
}

/**
 * Evaluates SLA status for a single zone given dwell times of patients in it.
 * @param {string} zone
 * @param {{ visitId: string; dwellMins: number }[]} dwells
 * @returns {ZoneSlaStatus}
 */
function evaluateZone(zone, dwells) {
  const thresholds = ZONE_THRESHOLDS[zone];
  if (!thresholds) {
    return {
      zone,
      patientCount: dwells.length,
      avgDwellMins: 0,
      maxDwellMins: 0,
      slaStatus: 'OK',
      bottleneckVisitIds: [],
      requiresDispatch: false,
    };
  }

  const { warningMins, breachMins } = thresholds;

  const totalDwell = dwells.reduce((acc, d) => acc + d.dwellMins, 0);
  const avgDwellMins = dwells.length > 0 ? totalDwell / dwells.length : 0;
  const maxDwellMins = dwells.length > 0 ? Math.max(...dwells.map((d) => d.dwellMins)) : 0;

  const breachedVisits = dwells.filter((d) => d.dwellMins >= breachMins).map((d) => d.visitId);
  const warnVisits = dwells.filter((d) => d.dwellMins >= warningMins && d.dwellMins < breachMins);

  let slaStatus = 'OK';
  if (breachedVisits.length > 0) {
    slaStatus = 'BREACH';
  } else if (warnVisits.length > 0 || avgDwellMins >= warningMins) {
    slaStatus = 'WARNING';
  }

  return {
    zone,
    patientCount: dwells.length,
    avgDwellMins: Math.round(avgDwellMins * 10) / 10,
    maxDwellMins: Math.round(maxDwellMins * 10) / 10,
    slaStatus,
    bottleneckVisitIds: breachedVisits,
    requiresDispatch: slaStatus === 'BREACH',
  };
}

/**
 * Evaluates floor-level SLA across all clinical zones given a live queue snapshot
 * and a list of clinical notes (for pharmacy status).
 *
 * @param {QueueEntry[]} queue      - Active visits (WAITING | CONSULTING)
 * @param {object[]}     clinicalNotes - Map of visitId → ClinicalNote (for pharmacy tracking)
 * @param {object[]}     billingClaims - Map of visitId → BillingClaim (for cashier tracking)
 * @returns {SlaReport}
 */
export function evaluateSla(queue, clinicalNotes = [], billingClaims = []) {
  const noteByVisitId = new Map(clinicalNotes.map((n) => [n.visitId, n]));
  const claimByVisitId = new Map(billingClaims.map((c) => [c.visitId, c]));

  // ── TRIAGE zone: Patients who are WAITING and have NO vitals yet ──────────
  const triageDwells = queue
    .filter((v) => v.status === 'WAITING' && !v.vitals)
    .map((v) => ({ visitId: v.visitId || v.id, dwellMins: elapsedMins(v.checkInAt) }));

  // ── DOCTOR zone: Patients who are WAITING (vitals done) or CONSULTING ─────
  const doctorDwells = queue
    .filter((v) => (v.status === 'WAITING' && v.vitals) || v.status === 'CONSULTING')
    .map((v) => ({
      visitId: v.visitId || v.id,
      // Use time since check-in for waiting; time since consultation start for consulting
      dwellMins: v.status === 'CONSULTING' && v.consultedAt
        ? elapsedMins(v.consultedAt)
        : elapsedMins(v.checkInAt),
    }));

  // ── PHARMACY zone: Notes with PENDING or PREPARING pharmacy status ─────────
  const pharmacyDwells = [];
  for (const [visitId, note] of noteByVisitId.entries()) {
    if (note.pharmacyStatus === 'PENDING' || note.pharmacyStatus === 'PREPARING') {
      pharmacyDwells.push({
        visitId,
        dwellMins: elapsedMins(note.createdAt),
      });
    }
  }

  // ── CASHIER zone: Approved/Flagged claims not yet PAID ────────────────────
  const cashierDwells = [];
  for (const [visitId, claim] of claimByVisitId.entries()) {
    if (claim.paymentStatus !== 'PAID' && ['PENDING', 'FLAGGED', 'SUBMITTED'].includes(claim.status)) {
      cashierDwells.push({
        visitId,
        dwellMins: elapsedMins(claim.createdAt),
      });
    }
  }

  // ── Evaluate each zone ────────────────────────────────────────────────────
  const triageZone = evaluateZone('TRIAGE', triageDwells);
  const doctorZone = evaluateZone('DOCTOR', doctorDwells);
  const pharmacyZone = evaluateZone('PHARMACY', pharmacyDwells);
  const cashierZone = evaluateZone('CASHIER', cashierDwells);

  const zones = [triageZone, doctorZone, pharmacyZone, cashierZone];

  const hasActiveBreach = zones.some((z) => z.slaStatus === 'BREACH');

  const breachSummary = zones
    .filter((z) => z.slaStatus === 'BREACH')
    .map(
      (z) =>
        `[${z.zone}] SLA BREACH: ${z.bottleneckVisitIds.length} patient(s) exceeded ${ZONE_THRESHOLDS[z.zone].breachMins}min threshold (max ${z.maxDwellMins}min)`
    );

  // Composite SLA score: each zone contributes 25 points
  // Deductions: WARNING → -8, BREACH → -25
  let overallSlaScore = 100;
  for (const z of zones) {
    if (z.slaStatus === 'BREACH') overallSlaScore -= 25;
    else if (z.slaStatus === 'WARNING') overallSlaScore -= 8;
  }
  overallSlaScore = Math.max(0, overallSlaScore);

  return {
    zones,
    hasActiveBreach,
    breachSummary,
    overallSlaScore,
    evaluatedAt: new Date(),
  };
}

/**
 * Determines which rooms require floor manager dispatch based on breach analysis.
 * Returns a prioritised list of dispatch actions.
 *
 * @param {SlaReport} slaReport
 * @returns {{ zone: string; urgency: 'HIGH'|'MEDIUM'; message: string }[]}
 */
export function getDispatchRecommendations(slaReport) {
  const recommendations = [];

  for (const zone of slaReport.zones) {
    if (zone.slaStatus === 'BREACH') {
      recommendations.push({
        zone: zone.zone,
        urgency: 'HIGH',
        message: `Dispatch floor manager to ${zone.zone} — ${zone.bottleneckVisitIds.length} patient(s) exceeded SLA by ${zone.maxDwellMins - ZONE_THRESHOLDS[zone.zone]?.breachMins} min`,
      });
    } else if (zone.slaStatus === 'WARNING') {
      recommendations.push({
        zone: zone.zone,
        urgency: 'MEDIUM',
        message: `Monitor ${zone.zone} — average dwell ${zone.avgDwellMins} min approaching ${ZONE_THRESHOLDS[zone.zone]?.breachMins} min threshold`,
      });
    }
  }

  // Sort: HIGH urgency first
  return recommendations.sort((a, b) => (a.urgency === 'HIGH' ? -1 : 1));
}

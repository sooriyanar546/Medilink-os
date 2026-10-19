/**
 * lib/services/QueueTrackingService.js
 *
 * Patient Journey Wayfinding & Queue Dwell Time Service
 *
 * Manages the 5-stage patient journey through the outpatient department:
 *   ENTRANCE → TRIAGE → DOCTOR_ROOM → PHARMACY → DISCHARGE
 *
 * Core capabilities:
 *   - Dynamic ETA calculation using provider velocity (consultations/hour)
 *   - Queue position management within each stage
 *   - Stage advancement with Pusher real-time event emission
 *   - Discharge HUD milestone synchronisation
 *   - Live queue telemetry for the Admin Mission Control telemetry endpoint
 *
 * Implementation notes:
 *   - All DB writes use raw SQL targeting the 003_patient_portal_schema tables
 *   - Pusher events are fire-and-forget (non-blocking) — failure never aborts journey update
 *   - ETA uses exponential smoothing to dampen velocity spikes from short samples
 */

import { prisma } from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';

// ─── Stage Definitions ────────────────────────────────────────────────────────

/**
 * Ordered stage progression map.
 * Key = current stage. Value = next stage (null = terminal).
 */
export const STAGE_PROGRESSION = {
  ENTRANCE:    'TRIAGE',
  TRIAGE:      'DOCTOR_ROOM',
  DOCTOR_ROOM: 'PHARMACY',
  PHARMACY:    'DISCHARGE',
  DISCHARGE:   null,
};

/**
 * Stage display metadata for the patient wayfinding HUD.
 */
export const STAGE_METADATA = {
  ENTRANCE: {
    label: 'Welcome — Check-in',
    icon: 'door-open',
    description: 'You have been registered. Please wait for your name to be called.',
    chime: false,
  },
  TRIAGE: {
    label: 'Triage Assessment',
    icon: 'stethoscope',
    description: 'A nurse will assess your vitals and symptoms shortly.',
    chime: true,
  },
  DOCTOR_ROOM: {
    label: 'Doctor Consultation',
    icon: 'user-md',
    description: 'Your name will be announced when the doctor is ready.',
    chime: true,
  },
  PHARMACY: {
    label: 'Pharmacy — Medication Collection',
    icon: 'pills',
    description: 'Please proceed to the pharmacy counter to collect your medications.',
    chime: true,
  },
  DISCHARGE: {
    label: 'Discharge — You\'re all set!',
    icon: 'check-circle',
    description: 'Your visit is complete. Please collect your prescription and billing summary.',
    chime: true,
  },
};

// ─── ETA Configuration ────────────────────────────────────────────────────────

/** Default provider velocity (consultations per hour) used when no live data available. */
const DEFAULT_VELOCITY = 3.0;

/**
 * Average dwell time (minutes) per stage per patient.
 * Used for computing downstream stage ETAs.
 */
const STAGE_DWELL_MINS = {
  ENTRANCE:    3,   // Registration / check-in admin time
  TRIAGE:      8,   // Nurse vitals assessment
  DOCTOR_ROOM: 15,  // Consultation duration
  PHARMACY:    10,  // Dispensation time
  DISCHARGE:   0,   // Instantaneous (terminal stage)
};

/**
 * Exponential smoothing alpha for velocity updates.
 * Higher = reacts faster to new velocity readings; lower = more stable.
 */
const ETA_SMOOTHING_ALPHA = 0.3;

// ─── Utility: ETA Calculation ─────────────────────────────────────────────────

/**
 * Calculates the estimated wait time for a patient at a given queue position and stage.
 *
 * Formula:
 *   intervalsAheadInStage = max(0, position - 1)
 *   currentStageWait = (intervalsAheadInStage * (60 / velocity)) + currentStageDwell
 *   downstreamWait = sum of STAGE_DWELL_MINS for remaining stages
 *   totalETA = currentStageWait + downstreamWait
 *
 * @param {string}  stage            - Current journey stage
 * @param {number}  position         - Queue position within the stage (1-indexed)
 * @param {number}  [velocity]       - Provider consultations/hour (defaults to DEFAULT_VELOCITY)
 * @param {boolean} [includeDownstream=true] - Include downstream stage wait in total
 * @returns {{ stage_wait_mins: number, total_eta_mins: number, velocity_used: number }}
 */
export function calculateETA(stage, position, velocity = DEFAULT_VELOCITY, includeDownstream = true) {
  const v = Math.max(0.5, velocity || DEFAULT_VELOCITY); // Floor at 0.5 to avoid division by zero
  const minutesPerConsultation = 60 / v;
  const patientsAhead = Math.max(0, (position || 1) - 1);

  // Wait within the current stage (queue depletion time + personal dwell)
  const stageWaitMins = Math.round(
    patientsAhead * minutesPerConsultation + (STAGE_DWELL_MINS[stage] || 5)
  );

  // Downstream wait: sum all stages after the current one
  let downstreamMins = 0;
  if (includeDownstream) {
    const stages = Object.keys(STAGE_PROGRESSION);
    const currentIndex = stages.indexOf(stage);
    for (let i = currentIndex + 1; i < stages.length; i++) {
      downstreamMins += STAGE_DWELL_MINS[stages[i]] || 0;
    }
  }

  const totalEtaMins = stageWaitMins + downstreamMins;

  return {
    stage_wait_mins: stageWaitMins,
    total_eta_mins: totalEtaMins,
    velocity_used: v,
  };
}

/**
 * Smoothly updates a stored velocity reading using exponential smoothing.
 * Prevents ETA thrashing from single anomalous readings.
 *
 * @param {number} storedVelocity   - Previously stored velocity
 * @param {number} newObservation   - Newly observed velocity
 * @returns {number} Smoothed velocity (2 decimal places)
 */
export function smoothVelocity(storedVelocity, newObservation) {
  const smoothed = ETA_SMOOTHING_ALPHA * newObservation + (1 - ETA_SMOOTHING_ALPHA) * storedVelocity;
  return Math.round(smoothed * 100) / 100;
}

// ─── Ticket Number Generator ──────────────────────────────────────────────────

/**
 * Generates a human-readable ticket number for a stage.
 * Format: prefix + zero-padded sequence number, e.g., "T-042", "D-017"
 *
 * @param {string} stage
 * @param {number} sequence  - 1-indexed position
 * @returns {string}
 */
function _ticketNumber(stage, sequence) {
  const prefix = {
    ENTRANCE:    'E',
    TRIAGE:      'T',
    DOCTOR_ROOM: 'D',
    PHARMACY:    'P',
    DISCHARGE:   'X',
  }[stage] || 'Q';
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

// ─── Pusher Event Emitter ─────────────────────────────────────────────────────

/**
 * @private
 * Emits a journey-update event to the patient's private Pusher channel.
 * Non-blocking — failures are logged but never throw.
 *
 * Channel convention: `private-patient-{patientId}`
 * Event: `journey-updated`
 *
 * @param {string} patientId
 * @param {Object} payload
 */
async function _emitJourneyUpdate(patientId, payload) {
  try {
    await pusherServer.trigger(
      `private-patient-${patientId}`,
      'journey-updated',
      payload
    );
  } catch (err) {
    console.warn('[QueueTrackingService] Pusher emit failed (non-fatal):', err.message);
  }
}

// ─── Core Service Functions ───────────────────────────────────────────────────

/**
 * Creates a new patient journey starting at ENTRANCE.
 * Automatically creates the first ENTRANCE queue ticket.
 *
 * @param {Object} params
 * @param {string}  params.patientId
 * @param {string}  [params.visitId]          - Associated visit ID (optional)
 * @param {number}  [params.providerVelocity]  - Current doctor velocity for ETA
 * @returns {Promise<Object>} Created journey record
 */
export async function createJourney({ patientId, visitId = null, providerVelocity = DEFAULT_VELOCITY }) {
  // Check for existing active journey
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM patient_journeys
     WHERE patient_id = $1 AND status = 'ACTIVE'
     LIMIT 1`,
    patientId,
  );

  if (existing.length > 0) {
    throw Object.assign(
      new Error(`Patient already has an active journey (id: ${existing[0].id}). Complete or cancel it first.`),
      { code: 'ACTIVE_JOURNEY_EXISTS', status: 409 }
    );
  }

  // Create journey
  const journeys = await prisma.$queryRawUnsafe(
    `INSERT INTO patient_journeys
       (patient_id, visit_id, current_stage, status, provider_velocity,
        stage_queue_position, entered_entrance_at, created_at, updated_at)
     VALUES ($1, $2, 'ENTRANCE', 'ACTIVE', $3, 1, NOW(), NOW(), NOW())
     RETURNING *`,
    patientId,
    visitId,
    providerVelocity,
  );

  const journey = journeys[0];

  // Count current ENTRANCE queue depth to assign correct position
  const countRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS cnt FROM queue_tickets
     WHERE stage = 'ENTRANCE' AND status IN ('PENDING','CALLED','SERVING')`,
  );
  const position = parseInt(countRows[0]?.cnt || '0', 10) + 1;

  // Create ENTRANCE queue ticket
  await prisma.$executeRawUnsafe(
    `INSERT INTO queue_tickets
       (journey_id, patient_id, stage, ticket_number, position, status,
        estimated_wait_mins, created_at)
     VALUES ($1, $2, 'ENTRANCE', $3, $4, 'PENDING', $5, NOW())`,
    journey.id,
    patientId,
    _ticketNumber('ENTRANCE', position),
    position,
    calculateETA('ENTRANCE', position, providerVelocity).stage_wait_mins,
  );

  const { total_eta_mins } = calculateETA('ENTRANCE', position, providerVelocity);

  // Emit real-time update
  await _emitJourneyUpdate(patientId, {
    journeyId: journey.id,
    stage: 'ENTRANCE',
    position,
    etaMinutes: total_eta_mins,
    meta: STAGE_METADATA.ENTRANCE,
    chime: false,
    timestamp: new Date().toISOString(),
  });

  return { journey, ticket_number: _ticketNumber('ENTRANCE', position), eta_minutes: total_eta_mins };
}

/**
 * Advances a patient's journey to the next stage.
 * Validates stage progression order; refuses out-of-sequence transitions.
 *
 * @param {Object} params
 * @param {string}  params.journeyId
 * @param {string}  params.patientId      - Used to authorise the transition
 * @param {number}  [params.newVelocity]  - Updated provider velocity observation
 * @returns {Promise<Object>} Updated journey with new stage, ETA, and ticket
 */
export async function advanceStage({ journeyId, patientId, newVelocity = null }) {
  // Load current journey
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM patient_journeys
     WHERE id = $1 AND patient_id = $2 AND status = 'ACTIVE'
     FOR UPDATE`,
    journeyId,
    patientId,
  );

  if (!rows.length) {
    throw Object.assign(new Error('Active journey not found.'), { code: 'JOURNEY_NOT_FOUND', status: 404 });
  }

  const journey = rows[0];
  const currentStage = journey.current_stage;
  const nextStage = STAGE_PROGRESSION[currentStage];

  if (!nextStage) {
    throw Object.assign(
      new Error(`Journey is already at the terminal stage (${currentStage}).`),
      { code: 'JOURNEY_COMPLETE', status: 409 }
    );
  }

  // Smooth velocity if new observation provided
  const updatedVelocity = newVelocity !== null
    ? smoothVelocity(journey.provider_velocity, newVelocity)
    : journey.provider_velocity;

  // Mark current ticket as DONE
  await prisma.$executeRawUnsafe(
    `UPDATE queue_tickets
       SET status = 'DONE', served_at = NOW()
     WHERE journey_id = $1 AND stage = $2 AND status IN ('PENDING','CALLED','SERVING')`,
    journeyId,
    currentStage,
  );

  // Get new queue depth for next stage
  const countRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS cnt FROM queue_tickets
     WHERE stage = $1 AND status IN ('PENDING','CALLED','SERVING')`,
    nextStage,
  );
  const nextPosition = parseInt(countRows[0]?.cnt || '0', 10) + 1;

  // Build stage timestamp column name
  const stageTimestampCol = {
    TRIAGE:      'entered_triage_at',
    DOCTOR_ROOM: 'entered_doctor_at',
    PHARMACY:    'entered_pharmacy_at',
    DISCHARGE:   'discharged_at',
  }[nextStage];

  // Update journey record
  const updated = await prisma.$queryRawUnsafe(
    `UPDATE patient_journeys
       SET current_stage = $1,
           stage_queue_position = $2,
           provider_velocity = $3,
           ${stageTimestampCol} = NOW(),
           updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    nextStage,
    nextPosition,
    updatedVelocity,
    journeyId,
  );

  // If terminal stage, mark journey COMPLETED
  if (STAGE_PROGRESSION[nextStage] === null) {
    await prisma.$executeRawUnsafe(
      `UPDATE patient_journeys SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`,
      journeyId,
    );
  }

  // Create new ticket for next stage
  const { stage_wait_mins, total_eta_mins } = calculateETA(nextStage, nextPosition, updatedVelocity);

  await prisma.$executeRawUnsafe(
    `INSERT INTO queue_tickets
       (journey_id, patient_id, stage, ticket_number, position, status,
        estimated_wait_mins, created_at)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, NOW())`,
    journeyId,
    patientId,
    nextStage,
    _ticketNumber(nextStage, nextPosition),
    nextPosition,
    stage_wait_mins,
  );

  const meta = STAGE_METADATA[nextStage];

  // Emit chime event for stage advancement
  await _emitJourneyUpdate(patientId, {
    journeyId,
    previousStage: currentStage,
    stage: nextStage,
    position: nextPosition,
    etaMinutes: total_eta_mins,
    meta,
    chime: meta.chime,
    timestamp: new Date().toISOString(),
  });

  return {
    journey: updated[0],
    next_stage: nextStage,
    ticket_number: _ticketNumber(nextStage, nextPosition),
    eta_minutes: total_eta_mins,
    chime: meta.chime,
  };
}

/**
 * Returns the current live journey status for a patient.
 * Includes queue position, ETA, stage metadata, and discharge HUD milestones.
 *
 * @param {string} patientId
 * @returns {Promise<Object|null>}
 */
export async function getJourneyStatus(patientId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT j.*, qt.ticket_number, qt.position, qt.status AS ticket_status, qt.estimated_wait_mins
     FROM patient_journeys j
     LEFT JOIN LATERAL (
       SELECT * FROM queue_tickets
       WHERE journey_id = j.id AND status IN ('PENDING','CALLED','SERVING')
       ORDER BY created_at DESC LIMIT 1
     ) qt ON true
     WHERE j.patient_id = $1 AND j.status = 'ACTIVE'
     LIMIT 1`,
    patientId,
  );

  if (!rows.length) return null;

  const j = rows[0];
  const { total_eta_mins } = calculateETA(
    j.current_stage,
    j.stage_queue_position || 1,
    j.provider_velocity || DEFAULT_VELOCITY,
    true
  );

  return {
    journeyId: j.id,
    visitId: j.visit_id,
    currentStage: j.current_stage,
    status: j.status,
    stageQueuePosition: j.stage_queue_position,
    ticketNumber: j.ticket_number,
    etaMinutes: total_eta_mins,
    meta: STAGE_METADATA[j.current_stage],
    timestamps: {
      entrance:    j.entered_entrance_at,
      triage:      j.entered_triage_at,
      doctorRoom:  j.entered_doctor_at,
      pharmacy:    j.entered_pharmacy_at,
      discharged:  j.discharged_at,
    },
    dischargeHUD: {
      doctorClearance:      j.doctor_clearance,
      pharmacyDispensation: j.pharmacy_dispensation,
      billingReconciliation:j.billing_reconciliation,
      transporterAssigned:  j.transporter_assigned,
      bedReleased:          j.bed_released,
    },
  };
}

/**
 * Updates one or more discharge HUD milestone flags for a journey.
 * Used by Nurse / Pharmacist / Cashier terminals to tick off discharge steps.
 *
 * @param {Object} params
 * @param {string}  params.journeyId
 * @param {Object}  params.milestones  - Partial { doctorClearance, pharmacyDispensation, ... }
 * @returns {Promise<Object>}
 */
export async function updateDischargeMilestone({ journeyId, milestones }) {
  const COLUMN_MAP = {
    doctorClearance:        'doctor_clearance',
    pharmacyDispensation:   'pharmacy_dispensation',
    billingReconciliation:  'billing_reconciliation',
    transporterAssigned:    'transporter_assigned',
    bedReleased:            'bed_released',
  };

  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const [key, col] of Object.entries(COLUMN_MAP)) {
    if (milestones[key] !== undefined) {
      setClauses.push(`${col} = $${idx}`);
      values.push(Boolean(milestones[key]));
      idx++;
    }
  }

  if (setClauses.length === 0) {
    throw Object.assign(new Error('No valid milestone fields provided.'), { code: 'INVALID_MILESTONE', status: 400 });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(journeyId);

  const updated = await prisma.$queryRawUnsafe(
    `UPDATE patient_journeys
       SET ${setClauses.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    ...values,
  );

  return updated[0] || null;
}

/**
 * Returns aggregate queue depth and average ETA per stage.
 * Used by Mission Control telemetry endpoint.
 *
 * @returns {Promise<Object>}
 */
export async function getLiveQueueTelemetry() {
  const stageDepth = await prisma.$queryRawUnsafe(
    `SELECT stage, COUNT(*) AS depth, AVG(estimated_wait_mins) AS avg_wait
     FROM queue_tickets
     WHERE status IN ('PENDING', 'CALLED', 'SERVING')
     GROUP BY stage`,
  );

  const result = {};
  for (const row of stageDepth) {
    result[row.stage] = {
      depth: parseInt(row.depth, 10),
      avg_wait_mins: Math.round(parseFloat(row.avg_wait) || 0),
    };
  }

  return result;
}

export const QueueTrackingService = {
  createJourney,
  advanceStage,
  getJourneyStatus,
  updateDischargeMilestone,
  getLiveQueueTelemetry,
  calculateETA,
  smoothVelocity,
  STAGE_PROGRESSION,
  STAGE_METADATA,
  STAGE_DWELL_MINS,
};

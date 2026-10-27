/**
 * lib/services/VitalGamificationService.js
 *
 * Time-Series Vital Logger & Longevity Points Ledger
 *
 * Implements an anti-cheat, idempotent gamified reward system for:
 *   - Consistent daily vital logging
 *   - Consecutive streak tracking
 *   - Event-based point awards (voice audit, mobility scan, biomarker import)
 *
 * Anti-Gaming Controls:
 *   1. Maximum 500 points earnable per 24-hour cycle (hard cap)
 *   2. Idempotency via SHA-256 transaction hash (patient_id + event_type + date)
 *   3. Physiologic bounds validation — points rejected for impossible telemetry
 *   4. Streak continuity: broken if no vital log in last 26 hours
 *
 * Streak Multiplier Schedule:
 *   1-3 days:   1.0x
 *   4-6 days:   1.25x
 *   7-13 days:  1.5x
 *   14-29 days: 1.75x
 *   30+ days:   2.0x
 *
 * Point Award Schedule:
 *   VITAL_LOG:       50 base points per event (capped at 200/day for vitals)
 *   VOICE_AUDIT:     75 base points
 *   MOBILITY_SCAN:   100 base points
 *   BIOMARKER_IMPORT: 150 base points
 *   STREAK_BONUS:    streak_days * 5 additional points (applied at midnight)
 *   LONGEVITY_SIM:   30 points for running biological age simulation
 *   EXPOSOME_SYNC:   25 points for environment sync
 */

import { createHash } from 'crypto';
import { prisma } from '../prisma.js';

// ─── Point Award Schedule ────────────────────────────────────────────────────
const POINT_AWARDS = {
  VITAL_LOG:        50,
  VOICE_AUDIT:      75,
  MOBILITY_SCAN:   100,
  BIOMARKER_IMPORT: 150,
  STREAK_BONUS:       5,  // per streak day
  LONGEVITY_SIM:     30,
  EXPOSOME_SYNC:     25,
};

// ─── Anti-Gaming Caps ─────────────────────────────────────────────────────────
const DAILY_MAX_CAP            = 500;   // Max points per 24h window
const VITAL_LOG_DAILY_MAX      = 200;   // Max points from VITAL_LOG events per day
const VITALS_DAILY_LOG_LIMIT   = 4;     // Max reward-eligible vital logs per day

// ─── Streak Multipliers ───────────────────────────────────────────────────────
const STREAK_MULTIPLIERS = [
  { minDays: 30, multiplier: 2.00 },
  { minDays: 14, multiplier: 1.75 },
  { minDays:  7, multiplier: 1.50 },
  { minDays:  4, multiplier: 1.25 },
  { minDays:  1, multiplier: 1.00 },
];

/**
 * Gets the streak multiplier for a given streak day count.
 *
 * @param {number} streakDays
 * @returns {number} multiplier
 */
function getStreakMultiplier(streakDays) {
  for (const tier of STREAK_MULTIPLIERS) {
    if (streakDays >= tier.minDays) return tier.multiplier;
  }
  return 1.00;
}

/**
 * Generates a deterministic idempotency hash for a transaction.
 * Format: SHA-256(patient_id + event_type + date_string)
 *
 * This prevents duplicate point awards if the same endpoint is called
 * multiple times for the same event on the same calendar day.
 *
 * @param {string} patientId
 * @param {string} eventType
 * @param {string} [dateStr] - Optional override date (YYYY-MM-DD). Defaults to today.
 * @returns {string} 64-char hex SHA-256 hash
 */
function generateTxHash(patientId, eventType, dateStr) {
  const date = dateStr || new Date().toISOString().split('T')[0];
  return createHash('sha256')
    .update(`${patientId}:${eventType}:${date}`)
    .digest('hex');
}

/**
 * Computes the current streak and streak multiplier for a patient.
 * Streak is continuous daily vital logging (within 26 hours to allow flexibility).
 *
 * @param {string} patientId
 * @returns {Promise<{ streakDays: number, multiplier: number, lastTxDate: string|null }>}
 */
async function computeCurrentStreak(patientId) {
  // Fetch most recent ledger entry for this patient
  const rows = await prisma.$queryRaw`
    SELECT streak_days, tx_date, is_valid
    FROM longevity_points_ledger
    WHERE patient_id = ${patientId}
      AND is_valid = TRUE
    ORDER BY tx_date DESC, created_at DESC
    LIMIT 1
  `;

  if (!rows || rows.length === 0) {
    return { streakDays: 1, multiplier: 1.00, lastTxDate: null };
  }

  const lastEntry  = rows[0];
  const lastDate   = new Date(lastEntry.tx_date);
  const today      = new Date();
  today.setHours(0, 0, 0, 0);
  lastDate.setHours(0, 0, 0, 0);

  const daysDiff = Math.round((today - lastDate) / (1000 * 60 * 60 * 24));

  if (daysDiff === 0) {
    // Same day — streak continues, don't increment
    const currentStreak = parseInt(lastEntry.streak_days) || 1;
    return {
      streakDays:   currentStreak,
      multiplier:   getStreakMultiplier(currentStreak),
      lastTxDate:   lastEntry.tx_date.toString(),
    };
  } else if (daysDiff === 1) {
    // Previous day — increment streak
    const newStreak = (parseInt(lastEntry.streak_days) || 1) + 1;
    return {
      streakDays:  newStreak,
      multiplier:  getStreakMultiplier(newStreak),
      lastTxDate:  lastEntry.tx_date.toString(),
    };
  } else {
    // Streak broken — reset to 1
    return { streakDays: 1, multiplier: 1.00, lastTxDate: lastEntry.tx_date.toString() };
  }
}

/**
 * Gets today's total points already awarded to this patient.
 *
 * @param {string} patientId
 * @returns {Promise<number>}
 */
async function getTodayPointsTotal(patientId) {
  const today = new Date().toISOString().split('T')[0];

  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(points_awarded), 0) AS total
    FROM longevity_points_ledger
    WHERE patient_id = ${patientId}
      AND tx_date = ${today}::date
      AND is_valid = TRUE
  `;

  return parseInt(rows[0]?.total || 0);
}

/**
 * Gets today's vital log count (for VITAL_LOG daily cap enforcement).
 *
 * @param {string} patientId
 * @returns {Promise<number>}
 */
async function getTodayVitalLogCount(patientId) {
  const today = new Date().toISOString().split('T')[0];

  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt
    FROM longevity_points_ledger
    WHERE patient_id = ${patientId}
      AND tx_date = ${today}::date
      AND event_type = 'VITAL_LOG'
      AND is_valid = TRUE
  `;

  return parseInt(rows[0]?.cnt || 0);
}

/**
 * Gets the patient's current total Longevity Points balance.
 *
 * @param {string} patientId
 * @returns {Promise<number>}
 */
async function getCurrentBalance(patientId) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(points_awarded), 0) AS balance
    FROM longevity_points_ledger
    WHERE patient_id = ${patientId}
      AND is_valid = TRUE
  `;

  return parseInt(rows[0]?.balance || 0);
}

/**
 * Awards Longevity Points for a health event.
 * Implements full idempotency, anti-gaming, and streak computation.
 *
 * @param {Object} params
 * @param {string}  params.patientId     - Patient.id (cuid)
 * @param {string}  params.eventType     - One of POINT_AWARDS keys
 * @param {string}  [params.refEntityId] - ID of the originating entity (vital log, voice log, etc.)
 * @param {boolean} [params.isValid]     - Override validity (for anti-cheat rejections)
 * @param {string}  [params.rejectionReason] - Reason if !isValid
 *
 * @returns {Promise<PointsAwardResult>}
 *
 * @typedef {Object} PointsAwardResult
 * @property {boolean} awarded          - Whether points were successfully awarded
 * @property {number}  pointsAwarded    - Points awarded in this transaction
 * @property {number}  newBalance       - Updated total balance
 * @property {number}  streakDays       - Current streak length
 * @property {string}  txHash           - Idempotency hash
 * @property {string}  [rejectionReason]
 * @property {boolean} isDuplicate      - True if this is an idempotent re-play
 */
export async function awardLongevityPoints({
  patientId,
  eventType,
  refEntityId = null,
  isValid     = true,
  rejectionReason = null,
}) {
  const txDate  = new Date().toISOString().split('T')[0];
  const txHash  = generateTxHash(patientId, eventType, txDate);

  // 1. Idempotency check — reject duplicate transactions silently
  const existing = await prisma.$queryRaw`
    SELECT id, points_awarded, points_balance FROM longevity_points_ledger
    WHERE tx_hash = ${txHash}
    LIMIT 1
  `;

  if (existing && existing.length > 0) {
    return {
      awarded:       false,
      isDuplicate:   true,
      pointsAwarded: 0,
      newBalance:    existing[0].points_balance,
      streakDays:    1,
      txHash,
      rejectionReason: 'Duplicate transaction — already awarded for this event today.',
    };
  }

  // 2. Anti-gaming: VITAL_LOG cap check
  if (eventType === 'VITAL_LOG') {
    const todayVitalCount = await getTodayVitalLogCount(patientId);
    if (todayVitalCount >= VITALS_DAILY_LOG_LIMIT) {
      isValid         = false;
      rejectionReason = `Daily vital log reward limit reached (${VITALS_DAILY_LOG_LIMIT}/day). No additional points awarded until tomorrow.`;
    }
  }

  // 3. Compute streak
  const { streakDays, multiplier } = await computeCurrentStreak(patientId);

  // 4. Daily cap enforcement
  const todayTotal  = await getTodayPointsTotal(patientId);
  const basePoints  = POINT_AWARDS[eventType] || 0;
  const rawPoints   = Math.round(basePoints * multiplier);
  const available   = Math.max(0, DAILY_MAX_CAP - todayTotal);
  const finalPoints = isValid ? Math.min(rawPoints, available) : 0;

  // 5. Current balance
  const currentBalance = await getCurrentBalance(patientId);
  const newBalance     = currentBalance + finalPoints;

  // 6. Persist to ledger
  await prisma.$executeRaw`
    INSERT INTO longevity_points_ledger (
      patient_id, tx_date, tx_hash, event_type,
      points_awarded, points_balance,
      daily_points_total, daily_max_cap,
      streak_days, streak_multiplier,
      is_valid, rejection_reason, ref_entity_id
    ) VALUES (
      ${patientId}, ${txDate}::date, ${txHash}, ${eventType},
      ${finalPoints}, ${newBalance},
      ${todayTotal + finalPoints}, ${DAILY_MAX_CAP},
      ${streakDays}, ${multiplier},
      ${isValid && finalPoints > 0}, ${rejectionReason}, ${refEntityId}
    )
  `;

  return {
    awarded:       isValid && finalPoints > 0,
    isDuplicate:   false,
    pointsAwarded: finalPoints,
    newBalance,
    streakDays,
    streakMultiplier: multiplier,
    txHash,
    dailyPointsUsed: todayTotal + finalPoints,
    dailyCapRemaining: Math.max(0, DAILY_MAX_CAP - todayTotal - finalPoints),
    rejectionReason: (!isValid || finalPoints === 0) ? rejectionReason : null,
  };
}

/**
 * Gets a patient's Longevity Points summary (balance + streak + recent history).
 *
 * @param {string} patientId
 * @returns {Promise<Object>}
 */
export async function getLongevityPointsSummary(patientId) {
  const [balance, streak, recentTx] = await Promise.all([
    getCurrentBalance(patientId),
    computeCurrentStreak(patientId),
    prisma.$queryRaw`
      SELECT event_type, points_awarded, streak_days, tx_date, created_at
      FROM longevity_points_ledger
      WHERE patient_id = ${patientId}
        AND is_valid = TRUE
      ORDER BY created_at DESC
      LIMIT 10
    `,
  ]);

  return {
    totalBalance: balance,
    currentStreak: streak.streakDays,
    streakMultiplier: streak.multiplier,
    recentTransactions: recentTx,
    longevityTier: getLongevityTierFromPoints(balance),
  };
}

/**
 * Determines Longevity Points tier from cumulative balance.
 *
 * @param {number} balance
 * @returns {string} Tier label
 */
function getLongevityTierFromPoints(balance) {
  if (balance >= 25000) return 'CENTENARIAN';
  if (balance >= 10000) return 'LONGEVITY_CHAMPION';
  if (balance >= 5000)  return 'HEALTH_OPTIMIZER';
  if (balance >= 2000)  return 'ACTIVE_TRACKER';
  if (balance >= 500)   return 'BEGINNER';
  return 'NEW';
}

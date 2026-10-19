/**
 * lib/services/ConsentVaultService.js
 *
 * ABDM/ABHA Cryptographic Consent Vault & Token Manager
 *
 * Implements the full consent artifact lifecycle required by the
 * Ayushman Bharat Digital Mission (ABDM) Health Data Management Policy (v2.0):
 *   REQUESTED → GRANTED → REVOKED | EXPIRED
 *
 * Security primitives:
 *   - HMAC-SHA256 bearer tokens (Node.js built-in `crypto` — no external deps)
 *   - Timing-safe comparison (`crypto.timingSafeEqual`) for verification
 *   - Cryptographically random nonces (token_jti) via `crypto.randomBytes`
 *   - Token payload includes: patientId, requesterId, purpose, scope, expiry, jti
 *
 * HIPAA / ABDM compliance:
 *   - All consent state changes are written to `consent_audit_log` (append-only)
 *   - No PHI (raw patient data) flows through this service — only IDs and metadata
 *   - Tokens are time-bounded; `expiry_timestamp` is enforced both in DB and in-memory
 *
 * NOTE: For production ABDM integration, replace HMAC-SHA256 signing with
 *       ECDSA P-256 (using Node `crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })`).
 *       The verifyToken() signature and public interface remain identical.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * ABDM-defined purpose codes for consent requests.
 * Maps to section 4.3 of the ABDM Health Data Management Policy.
 */
export const PURPOSE_CODES = {
  CARE_MANAGEMENT:       'CARE_MANAGEMENT',         // Direct patient care by treating provider
  BREAK_THE_GLASS:       'BREAK_THE_GLASS',         // Emergency override access
  SELF_REQUESTED:        'SELF_REQUESTED',           // Patient-initiated own-record access
  RESEARCH:              'RESEARCH',                 // Anonymised research (requires extra clearance)
  QUALITY_IMPROVEMENT:   'QUALITY_IMPROVEMENT',      // Internal audit / quality improvement
  INSURANCE:             'INSURANCE',                // TPA / insurance claim processing
};

/**
 * ABDM health data type codes (FHIR resource type strings).
 */
export const DATA_TYPES = {
  DIAGNOSTIC_REPORT:     'DiagnosticReport',
  PRESCRIPTION:          'Prescription',
  IMMUNIZATION_RECORD:   'ImmunizationRecord',
  WELLNESS_RECORD:       'WellnessRecord',
  DISCHARGE_SUMMARY:     'DischargeSummary',
  OP_CONSULTATION:       'OPConsultation',
};

/**
 * Default token validity periods in milliseconds.
 */
const DEFAULT_TTL_MS = {
  CARE_MANAGEMENT:       8  * 60 * 60 * 1000,   // 8 hours
  BREAK_THE_GLASS:       1  * 60 * 60 * 1000,   // 1 hour (emergency — short-lived)
  SELF_REQUESTED:        24 * 60 * 60 * 1000,   // 24 hours
  RESEARCH:              30 * 24 * 60 * 60 * 1000, // 30 days
  QUALITY_IMPROVEMENT:   7  * 24 * 60 * 60 * 1000, // 7 days
  INSURANCE:             48 * 60 * 60 * 1000,   // 48 hours
};

// HMAC secret key sourced from environment. Must be ≥ 32 bytes (256-bit security).
// Set CONSENT_HMAC_SECRET in your .env.local
const HMAC_SECRET = process.env.CONSENT_HMAC_SECRET || process.env.NEXTAUTH_SECRET;

if (!HMAC_SECRET) {
  // Non-fatal at module load; will fail at runtime when signing is attempted.
  console.error('[ConsentVaultService] CRITICAL: CONSENT_HMAC_SECRET is not set. Consent token signing will fail.');
}

// ─── Internal Signing & Verification ─────────────────────────────────────────

/**
 * @private
 * Signs a canonical payload string using HMAC-SHA256.
 * @param {string} canonical  - Deterministically serialised payload string
 * @returns {string}          - Hex-encoded HMAC-SHA256 signature
 */
function _sign(canonical) {
  if (!HMAC_SECRET) {
    throw new Error('CONSENT_HMAC_SECRET is not configured. Cannot issue consent tokens.');
  }
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(canonical, 'utf8')
    .digest('hex');
}

/**
 * @private
 * Builds the canonical payload string from structured token data.
 * Field order is fixed and sorted alphabetically to ensure determinism.
 *
 * @param {Object} payload
 * @returns {string}
 */
function _buildCanonical(payload) {
  // Sort keys for determinism; exclude the 'signature' field itself
  const keys = Object.keys(payload).filter(k => k !== 'signature').sort();
  return keys.map(k => `${k}=${JSON.stringify(payload[k])}`).join('&');
}

/**
 * @private
 * Generates a cryptographically random 32-byte hex string (JWT-style jti nonce).
 * @returns {string}
 */
function _generateJti() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * @private
 * Computes a SHA-256 hash of the canonical payload for audit trail integrity.
 * @param {string} canonical
 * @returns {string}
 */
function _hashPayload(canonical) {
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * @private
 * Timing-safe string comparison to prevent timing-attack against HMAC.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function _timingSafeEqual(a, b) {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─── Audit Logger ─────────────────────────────────────────────────────────────

/**
 * @private
 * Writes an entry to the append-only consent_audit_log table.
 * Runs as a fire-and-forget non-blocking operation. Errors are logged but do not
 * interrupt the main consent flow.
 */
async function _auditLog({ artifactId, patientId, actorId, actorRole, action, outcome, clientIp, userAgent, details }) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO consent_audit_log
         (artifact_id, patient_id, actor_id, actor_role, action, outcome, client_ip, user_agent, details, logged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9::jsonb, NOW())`,
      artifactId,
      patientId,
      actorId,
      actorRole,
      action,
      outcome,
      clientIp || null,
      userAgent || null,
      JSON.stringify(details || {}),
    );
  } catch (err) {
    // Never throw from audit log — log silently
    console.error('[ConsentVaultService] Audit log write failed:', err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ConsentArtifact
 * @property {string}   id
 * @property {string}   patientId
 * @property {string}   requesterId
 * @property {string}   requesterRole
 * @property {string}   purposeCode
 * @property {string[]} dataTypes
 * @property {Date|null} dateRangeStart
 * @property {Date|null} dateRangeEnd
 * @property {Date}     expiryTimestamp
 * @property {string}   tokenSignature
 * @property {string}   tokenPayloadHash
 * @property {string}   tokenJti
 * @property {string}   status     - 'REQUESTED'|'GRANTED'|'REVOKED'|'EXPIRED'
 */

/**
 * Issues a new ABHA consent request artifact (status = REQUESTED).
 * The patient must then call grantConsent() to activate it.
 *
 * @param {Object} params
 * @param {string}   params.patientId
 * @param {string}   params.requesterId        - Doctor/user ID making the request
 * @param {string}   params.requesterRole      - AppRole of requester
 * @param {string}   params.purposeCode        - One of PURPOSE_CODES
 * @param {string[]} params.dataTypes          - Array of DATA_TYPES values
 * @param {Date|null} [params.dateRangeStart]  - EHR data valid from (null = all history)
 * @param {Date|null} [params.dateRangeEnd]    - EHR data valid to (null = current)
 * @param {number}   [params.ttlMs]            - Custom TTL in ms; defaults to purpose default
 * @param {Object}   [params.scopeRestriction] - Additional scope constraints (visitIds etc.)
 * @param {Object}   [params.auditContext]     - { clientIp, userAgent }
 * @returns {Promise<ConsentArtifact>}
 */
export async function requestConsent({
  patientId,
  requesterId,
  requesterRole,
  purposeCode,
  dataTypes,
  dateRangeStart = null,
  dateRangeEnd = null,
  ttlMs = null,
  scopeRestriction = null,
  auditContext = {},
}) {
  // Validate inputs
  if (!PURPOSE_CODES[purposeCode]) {
    throw Object.assign(new Error(`Invalid purpose code: ${purposeCode}`), { code: 'INVALID_PURPOSE', status: 400 });
  }
  if (!Array.isArray(dataTypes) || dataTypes.length === 0) {
    throw Object.assign(new Error('At least one data type must be specified.'), { code: 'INVALID_DATA_TYPES', status: 400 });
  }

  const resolvedTtl = ttlMs || DEFAULT_TTL_MS[purposeCode] || DEFAULT_TTL_MS.CARE_MANAGEMENT;
  const expiryTimestamp = new Date(Date.now() + resolvedTtl);
  const jti = _generateJti();

  // Build canonical payload for signing
  const payloadCore = {
    jti,
    patientId,
    requesterId,
    purposeCode,
    dataTypes: [...dataTypes].sort(),                  // Sort for determinism
    dateRangeStart: dateRangeStart?.toISOString() || null,
    dateRangeEnd: dateRangeEnd?.toISOString() || null,
    expiryTimestamp: expiryTimestamp.toISOString(),
  };

  const canonical = _buildCanonical(payloadCore);
  const tokenSignature = _sign(canonical);
  const tokenPayloadHash = _hashPayload(canonical);

  // Persist to database (raw query targets the 003 migration tables)
  const artifact = await prisma.$queryRawUnsafe(
    `INSERT INTO abha_consent_artifacts
       (id, patient_id, requester_id, requester_role, purpose_code, data_types,
        date_range_start, date_range_end, expiry_timestamp,
        token_signature, token_payload_hash, token_jti,
        status, scope_restriction, created_at, updated_at)
     VALUES
       (gen_random_uuid()::TEXT, $1, $2, $3, $4, $5::TEXT[],
        $6, $7, $8,
        $9, $10, $11,
        'REQUESTED', $12::JSONB, NOW(), NOW())
     RETURNING *`,
    patientId,
    requesterId,
    requesterRole,
    purposeCode,
    dataTypes,
    dateRangeStart || null,
    dateRangeEnd || null,
    expiryTimestamp,
    tokenSignature,
    tokenPayloadHash,
    jti,
    JSON.stringify(scopeRestriction || null),
  );

  const created = artifact[0];

  await _auditLog({
    artifactId: created.id,
    patientId,
    actorId: requesterId,
    actorRole: requesterRole,
    action: 'REQUEST',
    outcome: 'SUCCESS',
    ...auditContext,
    details: { purposeCode, dataTypes, expiryTimestamp },
  });

  return created;
}

/**
 * Grants an existing REQUESTED consent artifact.
 * Only the patient themselves (or an authorised ADMIN acting on their behalf) may call this.
 *
 * @param {Object} params
 * @param {string}  params.artifactId
 * @param {string}  params.patientId        - Must match the artifact's patient
 * @param {Object}  [params.auditContext]   - { clientIp, userAgent }
 * @returns {Promise<ConsentArtifact>}      - Updated artifact with status = GRANTED
 */
export async function grantConsent({ artifactId, patientId, auditContext = {} }) {
  const rows = await prisma.$queryRawUnsafe(
    `UPDATE abha_consent_artifacts
       SET status = 'GRANTED', granted_at = NOW(), updated_at = NOW()
     WHERE id = $1
       AND patient_id = $2
       AND status = 'REQUESTED'
       AND expiry_timestamp > NOW()
     RETURNING *`,
    artifactId,
    patientId,
  );

  if (!rows.length) {
    throw Object.assign(
      new Error('Consent artifact not found, already processed, or expired.'),
      { code: 'GRANT_FAILED', status: 404 }
    );
  }

  const artifact = rows[0];

  await _auditLog({
    artifactId,
    patientId,
    actorId: patientId,
    actorRole: 'PATIENT',
    action: 'GRANT',
    outcome: 'SUCCESS',
    ...auditContext,
    details: { purposeCode: artifact.purpose_code },
  });

  return artifact;
}

/**
 * Revokes a GRANTED consent artifact.
 * Either the patient or an ADMIN can revoke consent.
 *
 * @param {Object} params
 * @param {string}  params.artifactId
 * @param {string}  params.revokedByUserId
 * @param {string}  params.revokedByRole      - 'PATIENT' | 'ADMIN'
 * @param {string}  [params.reason]           - Optional plain-text reason
 * @param {Object}  [params.auditContext]
 * @returns {Promise<ConsentArtifact>}
 */
export async function revokeConsent({ artifactId, revokedByUserId, revokedByRole, reason = null, auditContext = {} }) {
  const rows = await prisma.$queryRawUnsafe(
    `UPDATE abha_consent_artifacts
       SET status = 'REVOKED',
           revoked_at = NOW(),
           revocation_reason = $3,
           updated_at = NOW()
     WHERE id = $1
       AND status = 'GRANTED'
     RETURNING *`,
    artifactId,
    revokedByUserId,  // Not used in WHERE but available for future RLS
    reason,
  );

  if (!rows.length) {
    throw Object.assign(
      new Error('Consent artifact not found or is not currently GRANTED.'),
      { code: 'REVOKE_FAILED', status: 404 }
    );
  }

  const artifact = rows[0];

  await _auditLog({
    artifactId,
    patientId: artifact.patient_id,
    actorId: revokedByUserId,
    actorRole: revokedByRole,
    action: 'REVOKE',
    outcome: 'SUCCESS',
    ...auditContext,
    details: { reason },
  });

  return artifact;
}

/**
 * Verifies a bearer token presented by a clinician to access PHI.
 *
 * Verification steps:
 *   1. Lookup artifact by token_jti (index-backed, O(1))
 *   2. Assert status = GRANTED
 *   3. Assert expiry_timestamp > NOW()
 *   4. Recompute canonical payload and re-sign
 *   5. Timing-safe compare recomputed signature vs stored signature
 *
 * @param {Object} params
 * @param {string}  params.jti              - Token JTI (unique token ID) from bearer header
 * @param {string}  params.requestedByUserId - Clinician ID presenting the token
 * @param {string}  params.requestedByRole
 * @param {Object}  [params.auditContext]
 * @returns {Promise<{ valid: boolean, artifact: ConsentArtifact|null, reason: string|null }>}
 */
export async function verifyToken({ jti, requestedByUserId, requestedByRole, auditContext = {} }) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM abha_consent_artifacts
     WHERE token_jti = $1
     LIMIT 1`,
    jti,
  );

  const artifact = rows[0] || null;

  if (!artifact) {
    return { valid: false, artifact: null, reason: 'Token not found.' };
  }

  if (artifact.status !== 'GRANTED') {
    await _auditLog({
      artifactId: artifact.id,
      patientId: artifact.patient_id,
      actorId: requestedByUserId,
      actorRole: requestedByRole,
      action: 'VERIFY',
      outcome: 'DENIED',
      ...auditContext,
      details: { reason: `status=${artifact.status}` },
    });
    return { valid: false, artifact, reason: `Consent is ${artifact.status}.` };
  }

  if (new Date(artifact.expiry_timestamp) <= new Date()) {
    // Eagerly mark as expired in DB (best-effort, non-blocking)
    prisma.$executeRawUnsafe(
      `UPDATE abha_consent_artifacts SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
      artifact.id
    ).catch(() => {});

    await _auditLog({
      artifactId: artifact.id,
      patientId: artifact.patient_id,
      actorId: requestedByUserId,
      actorRole: requestedByRole,
      action: 'VERIFY',
      outcome: 'DENIED',
      ...auditContext,
      details: { reason: 'EXPIRED', expiredAt: artifact.expiry_timestamp },
    });
    return { valid: false, artifact, reason: 'Consent token has expired.' };
  }

  // ── Cryptographic signature re-verification ──────────────────────────────
  const payloadCore = {
    jti: artifact.token_jti,
    patientId: artifact.patient_id,
    requesterId: artifact.requester_id,
    purposeCode: artifact.purpose_code,
    dataTypes: [...artifact.data_types].sort(),
    dateRangeStart: artifact.date_range_start ? new Date(artifact.date_range_start).toISOString() : null,
    dateRangeEnd: artifact.date_range_end ? new Date(artifact.date_range_end).toISOString() : null,
    expiryTimestamp: new Date(artifact.expiry_timestamp).toISOString(),
  };

  const canonical = _buildCanonical(payloadCore);
  const expectedSignature = _sign(canonical);
  const signatureValid = _timingSafeEqual(expectedSignature, artifact.token_signature);

  if (!signatureValid) {
    await _auditLog({
      artifactId: artifact.id,
      patientId: artifact.patient_id,
      actorId: requestedByUserId,
      actorRole: requestedByRole,
      action: 'VERIFY',
      outcome: 'FAILURE',
      ...auditContext,
      details: { reason: 'SIGNATURE_MISMATCH' },
    });
    return { valid: false, artifact, reason: 'Token signature is invalid.' };
  }

  // ── Success ───────────────────────────────────────────────────────────────
  await _auditLog({
    artifactId: artifact.id,
    patientId: artifact.patient_id,
    actorId: requestedByUserId,
    actorRole: requestedByRole,
    action: 'ACCESS',
    outcome: 'SUCCESS',
    ...auditContext,
    details: { purposeCode: artifact.purpose_code, dataTypes: artifact.data_types },
  });

  return { valid: true, artifact, reason: null };
}

/**
 * Returns the bearer token string to be sent in an Authorization header.
 * Format: "ABHA <jti>" — simple, lightweight, and verifiable without JWT library.
 *
 * @param {string} jti
 * @returns {string}
 */
export function formatBearerToken(jti) {
  return `ABHA ${jti}`;
}

/**
 * Extracts the JTI from a formatted bearer token string.
 * @param {string} authorizationHeader  - e.g., "ABHA abc123..."
 * @returns {string|null}
 */
export function extractJtiFromBearer(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith('ABHA ')) return null;
  return authorizationHeader.slice(5).trim() || null;
}

/**
 * Returns all GRANTED consent artifacts for a given patient ID.
 * Used to render the patient's Consent Vault in PatientMode.
 *
 * @param {string} patientId
 * @returns {Promise<ConsentArtifact[]>}
 */
export async function getActiveConsentsForPatient(patientId) {
  return prisma.$queryRawUnsafe(
    `SELECT id, patient_id, requester_id, requester_role, purpose_code,
            data_types, date_range_start, date_range_end, expiry_timestamp,
            status, granted_at, scope_restriction
     FROM abha_consent_artifacts
     WHERE patient_id = $1
       AND status = 'GRANTED'
       AND expiry_timestamp > NOW()
     ORDER BY granted_at DESC`,
    patientId,
  );
}

export const ConsentVaultService = {
  requestConsent,
  grantConsent,
  revokeConsent,
  verifyToken,
  formatBearerToken,
  extractJtiFromBearer,
  getActiveConsentsForPatient,
  PURPOSE_CODES,
  DATA_TYPES,
};

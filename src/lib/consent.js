import crypto from 'crypto';

const SIGNING_SECRET = process.env.CONSENT_SIGNING_SECRET || process.env.AUTH_SECRET || 'fallback-consent-signing-secret-key-32-chars';

/**
 * Generates a cryptographically signed HMAC token representing patient consent.
 * 
 * @param {string} patientId - ID of the patient granting consent
 * @param {string} accessorId - User ID, Doctor ID, or '*' of the authorized accessor
 * @param {string} accessorRole - AppRole authorized (e.g. DOCTOR, PHARMACIST)
 * @param {string} accessLevel - ConsentAccessLevel (CLINICAL, MEDICATION, BILLING)
 * @param {Date|string} expiresAt - Timestamp when the consent token expires
 * @returns {string} HMAC SHA-256 hex digest signature
 */
export function generateConsentToken(patientId, accessorId, accessorRole, accessLevel, expiresAt) {
  const dateStr = new Date(expiresAt).toISOString();
  const payload = `${patientId}:${accessorId}:${accessorRole}:${accessLevel}:${dateStr}`;
  
  return crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('hex');
}

/**
 * Verifies the integrity and status of a PatientConsent record.
 * 
 * @param {Object} record - PatientConsent database record
 * @returns {boolean} True if signature is valid, status is ACTIVE, and token is not expired.
 */
export function verifyConsentToken(record) {
  if (!record || record.status !== 'ACTIVE') {
    return false;
  }

  // Check expiration
  if (new Date(record.expiresAt) <= new Date()) {
    return false;
  }

  // Recompute signature to verify database integrity (anti-tamper check)
  const dateStr = new Date(record.expiresAt).toISOString();
  const payload = `${record.patientId}:${record.accessorId}:${record.accessorRole}:${record.accessLevel}:${dateStr}`;
  
  const expectedToken = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('hex');

  return record.consentToken === expectedToken;
}

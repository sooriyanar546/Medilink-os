/**
 * lib/middleware/verifyConsentToken.js
 *
 * ABDM & HIPAA Cryptographic Consent Verification Middleware
 *
 * Enforces patient consent verification for any API route handler accessing PHI.
 *
 * Authorization Hierarchy:
 *   1. ADMIN role -> Granted with 'ADMIN_OVERRIDE' audit trail.
 *   2. PATIENT self-access (session.user.patientId === targetPatientId) -> Granted with 'PATIENT_SELF'.
 *   3. Emergency Break-Glass (X-Emergency-Break-Glass: true) -> Permitted for DOCTOR/ADMIN with high-priority audit log.
 *   4. Clinician/Staff access -> Requires valid, unexpired, cryptographic consent artifact from ABDM Consent Vault.
 *
 * Supported Token Formats in Request:
 *   - Header: Authorization: ABHA <jti>
 *   - Header: Authorization: Bearer <jti>
 *   - Header: X-Consent-Token: <jti>
 *   - Query string: ?consentToken=<jti> or ?token_jti=<jti>
 *
 * Exports:
 *   - extractConsentToken(request)
 *   - verifyConsentRequest(request, session, targetPatientId, options)
 *   - withConsentVerification(options, handler)
 */

import { verifyToken, extractJtiFromBearer } from '../services/ConsentVaultService.js';
import { logAudit } from '../audit.js';
import prisma from '../prisma.js';

let _authFn = null;
async function resolveSession() {
  if (!_authFn) {
    try {
      const authMod = await import('../../auth.js');
      _authFn = authMod.auth || authMod.default;
    } catch {
      _authFn = async () => null;
    }
  }
  return typeof _authFn === 'function' ? _authFn() : null;
}

/**
 * Extracts client IP address from proxy/gateway headers.
 * @param {Request} request
 * @returns {string}
 */
export function extractClientIp(request) {
  return (
    request.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers?.get('x-real-ip') ||
    request.headers?.get('cf-connecting-ip') ||
    '127.0.0.1'
  );
}

/**
 * Extracts the consent token (JTI) from Authorization header, custom headers, or query parameters.
 *
 * @param {Request} request
 * @returns {string|null}
 */
export function extractConsentToken(request) {
  if (!request) return null;

  // 1. Check custom X-Consent-Token header
  const customHeader = request.headers?.get('x-consent-token');
  if (customHeader && customHeader.trim()) {
    return customHeader.trim();
  }

  // 2. Check standard Authorization header ("ABHA <jti>" or "Bearer <jti>")
  const authHeader = request.headers?.get('authorization');
  if (authHeader) {
    const abhaJti = extractJtiFromBearer(authHeader);
    if (abhaJti) return abhaJti;

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      // Handle potential "Bearer ABHA <jti>"
      if (token.startsWith('ABHA ')) {
        return token.slice(5).trim();
      }
      if (token) return token;
    }
  }

  // 3. Check query parameters
  try {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('consentToken') || url.searchParams.get('token_jti');
    if (queryToken && queryToken.trim()) {
      return queryToken.trim();
    }
  } catch {
    // URL parsing fallback
  }

  return null;
}

/**
 * Core validation routine: checks if the caller is authorized to view/modify the patient's data.
 *
 * @param {Request} request
 * @param {Object} session - NextAuth session object
 * @param {string} targetPatientId - Patient ID whose data is being accessed
 * @param {Object} [options]
 * @param {string} [options.requiredDataType] - FHIR data type (e.g., 'DiagnosticReport', 'Prescription')
 * @param {boolean} [options.allowBreakGlass=true] - Whether emergency break-glass is permitted
 * @returns {Promise<{ authorized: boolean, status: number, error?: string, artifact?: Object, authType: string }>}
 */
export async function verifyConsentRequest(request, session, targetPatientId, options = {}) {
  const { requiredDataType = null, allowBreakGlass = true } = options;

  if (!session?.user) {
    return {
      authorized: false,
      status: 401,
      error: 'Authentication required. Active session not found.',
      authType: 'UNAUTHENTICATED',
    };
  }

  const role = (session.user.role || '').toUpperCase();
  const userId = session.user.id;
  const sessionPatientId = session.user.patientId;
  const clientIp = extractClientIp(request);
  const userAgent = request.headers?.get('user-agent') || 'Unknown';

  // 1. Admin Full Override
  if (role === 'ADMIN') {
    await logAudit(
      userId,
      session.user.name || 'Hospital Admin',
      role,
      'ADMIN_CONSENT_BYPASS',
      targetPatientId,
      { clientIp, reason: 'System administrator override', targetPatientId }
    );
    return { authorized: true, status: 200, authType: 'ADMIN_OVERRIDE' };
  }

  // 2. Patient Self Access
  if (role === 'PATIENT' && sessionPatientId && sessionPatientId === targetPatientId) {
    return { authorized: true, status: 200, authType: 'PATIENT_SELF' };
  }

  // 3. Emergency Break-Glass Override
  const breakGlassRequested = request.headers?.get('x-emergency-break-glass') === 'true';
  if (breakGlassRequested && allowBreakGlass) {
    if (role === 'DOCTOR' || role === 'ADMIN') {
      const doctorName = session.user.name || 'Emergency Doctor';
      await logAudit(
        userId,
        doctorName,
        role,
        'EMERGENCY_BREAK_GLASS_ACCESS',
        targetPatientId,
        {
          clientIp,
          userAgent,
          targetPatientId,
          reason: 'Emergency clinical override declared by provider',
          timestamp: new Date().toISOString(),
        }
      );
      return { authorized: true, status: 200, authType: 'BREAK_THE_GLASS' };
    }
  }

  // 4. Cryptographic ABDM Consent Token Verification
  const tokenJti = extractConsentToken(request);

  if (!tokenJti) {
    // Check if there is an active consent in the legacy PatientConsent table as fallback
    try {
      const legacyConsent = await prisma.patientConsent?.findFirst?.({
        where: {
          patientId: targetPatientId,
          accessorId: session.user.doctorId || userId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      });

      if (legacyConsent) {
        return { authorized: true, status: 200, authType: 'LEGACY_PATIENT_CONSENT' };
      }
    } catch {
      // Table may not have record or relation; proceed to rejection
    }

    await logAudit(
      userId,
      session.user.name || 'Clinician',
      role,
      'CONSENT_TOKEN_MISSING',
      targetPatientId,
      { clientIp, targetPatientId, attemptedAction: 'PHI_ACCESS_DENIED' }
    );

    return {
      authorized: false,
      status: 403,
      error: 'Patient consent required. Missing valid ABHA consent authorization token.',
      authType: 'NO_TOKEN',
    };
  }

  // Verify against ABDM Consent Vault
  const verification = await verifyToken({
    jti: tokenJti,
    requestedByUserId: userId,
    requestedByRole: role,
    auditContext: { clientIp, userAgent },
  });

  if (!verification.valid) {
    return {
      authorized: false,
      status: 403,
      error: `Consent authorization failed: ${verification.reason}`,
      authType: 'INVALID_TOKEN',
    };
  }

  const artifact = verification.artifact;

  // Validate that the token belongs to the target patient
  if (artifact.patient_id !== targetPatientId) {
    await logAudit(
      userId,
      session.user.name || 'Clinician',
      role,
      'CONSENT_PATIENT_MISMATCH',
      targetPatientId,
      { clientIp, tokenPatientId: artifact.patient_id, requestedPatientId: targetPatientId }
    );
    return {
      authorized: false,
      status: 403,
      error: 'Presented consent token is not valid for the requested patient.',
      authType: 'PATIENT_MISMATCH',
    };
  }

  // Validate data type permission if specified
  if (requiredDataType && Array.isArray(artifact.data_types)) {
    if (!artifact.data_types.includes(requiredDataType)) {
      return {
        authorized: false,
        status: 403,
        error: `Consent does not cover requested data type: ${requiredDataType}`,
        authType: 'SCOPE_MISMATCH',
      };
    }
  }

  return {
    authorized: true,
    status: 200,
    artifact,
    authType: 'ABHA_TOKEN_VERIFIED',
  };
}

/**
 * Higher-order wrapper for Next.js route handlers requiring verified patient consent.
 *
 * @param {Object} options
 * @param {string} [options.patientIdParam='patientId'] - Where patientId is located ('query' | 'param' | 'body')
 * @param {string} [options.requiredDataType] - Required ABDM data type
 * @param {Function} handler - (request, session, consentContext) => Promise<Response>
 * @returns {Function} Guarded route handler
 */
export function withConsentVerification(options = {}, handler) {
  return async function consentGuardedRoute(request, ...args) {
    const session = await resolveSession();

    if (!session?.user) {
      return Response.json(
        { error: 'Unauthorized: Authentication required.' },
        { status: 401 }
      );
    }

    // Resolve target patient ID
    let targetPatientId = null;

    // Check query params
    try {
      const url = new URL(request.url);
      targetPatientId = url.searchParams.get(options.patientIdParam || 'patientId');
    } catch {}

    // If not found in query, check if user is a PATIENT accessing own endpoint
    if (!targetPatientId && session.user.role?.toUpperCase() === 'PATIENT') {
      targetPatientId = session.user.patientId || session.user.id;
    }

    // If still null and it's a dynamic route param: args[0]?.params?.patientId
    if (!targetPatientId && args[0]?.params) {
      const resolvedParams = await Promise.resolve(args[0].params);
      targetPatientId = resolvedParams?.patientId || resolvedParams?.id;
    }

    const verification = await verifyConsentRequest(request, session, targetPatientId, options);

    if (!verification.authorized) {
      return Response.json(
        { error: verification.error || 'Access denied by patient consent policy.' },
        { status: verification.status || 403 }
      );
    }

    return handler(request, session, {
      patientId: targetPatientId,
      artifact: verification.artifact,
      authType: verification.authType,
    }, ...args);
  };
}

export const VerifyConsentMiddleware = {
  extractClientIp,
  extractConsentToken,
  verifyConsentRequest,
  withConsentVerification,
};

export default withConsentVerification;

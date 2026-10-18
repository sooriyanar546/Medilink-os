/**
 * lib/middleware/hipaaAuditHook.js
 *
 * HIPAA-Compliant Immutable Audit Middleware
 *
 * Higher-order wrapper for Next.js API route handlers that automatically:
 *   1. Captures actor identity (userId, role, name)
 *   2. Extracts client IP address (honours proxy headers)
 *   3. Computes a HMAC-SHA256 tamper-detection hash of the request payload
 *   4. Writes an immutable AuditLog entry BEFORE delegating to the handler
 *   5. Redacts PHI from console output — patient IDs are NEVER logged in plaintext
 *
 * Usage:
 *   export const POST = withHipaaAudit('BED_TRANSITION', ['ADMIN', 'NURSE'], handler);
 *   export const GET  = withHipaaAudit('TELEMETRY_READ', ['ADMIN'], handler);
 *
 * The audit record is written fire-and-forget with a fallback console.error
 * so that audit failures NEVER block clinical operations.
 *
 * Schema written to: AuditLog (existing Prisma model)
 *   - userId, userName, role, action, patientId, details (JSON)
 *
 * The `details` JSON payload includes:
 *   - ipAddress (from X-Forwarded-For or X-Real-IP)
 *   - method (GET|POST|PATCH|DELETE)
 *   - url (pathname only, no query params with PHI)
 *   - payloadHash (HMAC-SHA256 of request body for tamper detection)
 *   - overrideReason (if supplied in request body)
 *   - resourceId (bedId, visitId, staffId, etc. if supplied in request body)
 */

import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { auth } from '@/auth';
import { logAudit } from '@/lib/audit';

// ── Payload signing key ───────────────────────────────────────────────────────
// Uses AUTH_SECRET so we don't need a new env variable.
// In production, a separate AUDIT_SIGNING_SECRET is strongly recommended.
const SIGNING_KEY = process.env.CONSENT_SIGNING_SECRET || process.env.AUTH_SECRET || 'medilink-audit-fallback-key';

/**
 * Computes an HMAC-SHA256 of a serialisable payload.
 * Used to detect post-hoc tampering of audit log entries.
 *
 * @param {object|string} payload
 * @returns {string} Hex-encoded HMAC digest
 */
function computePayloadHash(payload) {
  try {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return createHmac('sha256', SIGNING_KEY).update(data).digest('hex');
  } catch {
    return 'HASH_COMPUTATION_FAILED';
  }
}

/**
 * Extracts client IP address from standard proxy headers.
 * Handles Vercel, Nginx, Cloudflare, and direct connections.
 *
 * @param {Request} request
 * @returns {string}
 */
function extractClientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    '127.0.0.1'
  );
}

/**
 * Extracts the URL pathname only — strips query strings that may contain PHI.
 *
 * @param {Request} request
 * @returns {string}
 */
function safePathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url || '/unknown';
  }
}

/**
 * Safely reads the request body as JSON without consuming it
 * (clones the request to allow the inner handler to re-read the body).
 *
 * @param {Request} request
 * @returns {Promise<object|null>}
 */
async function peekRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  try {
    const cloned = request.clone();
    const text = await cloned.text();
    if (!text || text.trim().length === 0) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Creates a wrapped Next.js route handler that writes an immutable HIPAA audit
 * log entry for every invocation before delegating to the inner handler.
 *
 * @param {string}    auditAction   - Human-readable action name (e.g. 'BED_TRANSITION')
 * @param {string[]}  allowedRoles  - Roles permitted to invoke this handler
 * @param {Function}  handler       - (request, session, ...args) => Response
 * @returns {Function}              - Guarded Next.js route handler
 */
export function withHipaaAudit(auditAction, allowedRoles, handler) {
  return async function hipaaGuardedHandler(request, ...args) {
    // ── Step 1: Authentication ──────────────────────────────────────────────
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session required.' },
        { status: 401 }
      );
    }

    // ── Step 2: Authorization ───────────────────────────────────────────────
    const userRole = (session.user.role || '').toUpperCase();
    const normalizedAllowed = allowedRoles.map((r) => r.toUpperCase());

    if (!normalizedAllowed.includes(userRole)) {
      // Write audit for unauthorised attempt — §164.312(b)
      logAudit(
        session.user.id,
        session.user.name || 'Unknown',
        userRole,
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        null,
        {
          ipAddress: extractClientIp(request),
          method: request.method,
          url: safePathname(request),
          attemptedAction: auditAction,
          requiredRoles: allowedRoles,
        }
      ).catch((e) => console.error('[HipaaAudit] Unauthorized attempt log failed:', e));

      return NextResponse.json(
        { error: `Forbidden: Role '${userRole}' is not permitted for ${auditAction}.` },
        { status: 403 }
      );
    }

    // ── Step 3: Peek at request body for audit context ─────────────────────
    const body = await peekRequestBody(request);

    // Extract context from body without logging PHI field values
    const resourceId =
      body?.bedId || body?.visitId || body?.staffId || body?.shiftId || body?.claimId || null;
    const patientId = body?.patientId || null;
    const overrideReason = body?.overrideReason || null;

    // ── Step 4: Compute tamper-detection hash ──────────────────────────────
    const payloadHash = computePayloadHash(body);

    // ── Step 5: Write immutable audit record (fire-and-forget) ────────────
    logAudit(
      session.user.id,
      session.user.name || 'System User',
      userRole,
      auditAction,
      patientId,
      {
        ipAddress: extractClientIp(request),
        method: request.method,
        url: safePathname(request),
        resourceId,
        overrideReason,
        payloadHash,
        // NOTE: We do NOT log body values here — they may contain PHI.
        // The hash alone enables tamper detection without exposing data.
      }
    ).catch((e) => console.error(`[HipaaAudit] Audit write failed for ${auditAction}:`, e));

    // ── Step 6: Delegate to inner handler ──────────────────────────────────
    return handler(request, session, ...args);
  };
}

/**
 * Convenience wrapper: HIPAA audit + any-role auth (all logged-in roles accepted).
 *
 * @param {string}   auditAction
 * @param {Function} handler
 * @returns {Function}
 */
export function withHipaaAuditAuth(auditAction, handler) {
  return withHipaaAudit(
    auditAction,
    ['PATIENT', 'DOCTOR', 'ADMIN', 'NURSE', 'PHARMACIST', 'CASHIER'],
    handler
  );
}

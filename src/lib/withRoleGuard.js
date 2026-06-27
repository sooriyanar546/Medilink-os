/**
 * lib/withRoleGuard.js
 *
 * Higher-order wrapper for Next.js API route handlers.
 * Enforces two security controls on every call:
 *   1. Authentication — valid NextAuth v5 session required
 *   2. Authorization  — caller's role must be in allowedRoles[]
 *
 * On success, injects the validated `session` as a second argument
 * to the inner handler. On failure, returns 401/403 immediately
 * and writes an audit log entry for the failed attempt.
 *
 * Usage:
 *   export const GET = withRoleGuard(['ADMIN', 'DOCTOR'], async (req, session) => {
 *     // session.user.role is guaranteed to be in ['ADMIN', 'DOCTOR']
 *     return NextResponse.json(data);
 *   });
 *
 * Role strings are compared case-insensitively against the JWT value.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logAudit } from '@/lib/audit';

/**
 * @param {string[]} allowedRoles  - Roles permitted to call this handler
 * @param {Function} handler       - (request, session, ...args) => Response
 * @returns {Function}             - Next.js route handler
 */
export function withRoleGuard(allowedRoles, handler) {
  return async function guardedHandler(request, ...args) {
    // ─── Step 1: Authentication ──────────────────────────────
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session required.' },
        { status: 401 }
      );
    }

    // ─── Step 2: Authorization ────────────────────────────────
    const userRole = (session.user.role || '').toUpperCase();
    const normalizedAllowed = allowedRoles.map((r) => r.toUpperCase());

    if (!normalizedAllowed.includes(userRole)) {
      // Audit every unauthorized access attempt — HIPAA §164.312(b)
      await logAudit(
        session.user.id,
        session.user.name || 'Unknown',
        userRole,
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        null,
        {
          attemptedRoute: request.url,
          requiredRoles: allowedRoles,
          method: request.method,
        }
      ).catch((e) => console.error('[withRoleGuard] Audit write failed:', e));

      return NextResponse.json(
        {
          error: `Forbidden: Role '${userRole}' is not permitted to access this resource.`,
          requiredRoles: allowedRoles,
        },
        { status: 403 }
      );
    }

    // ─── Step 3: Delegate to inner handler ────────────────────
    return handler(request, session, ...args);
  };
}

/**
 * Convenience: guard that ONLY checks authentication (any role allowed).
 * Use for endpoints any logged-in user can access.
 */
export function withAuth(handler) {
  return withRoleGuard(
    ['PATIENT', 'DOCTOR', 'ADMIN', 'NURSE', 'PHARMACIST', 'CASHIER'],
    handler
  );
}

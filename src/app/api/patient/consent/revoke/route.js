/**
 * app/api/patient/consent/revoke/route.js
 *
 * ABDM Patient Consent Revocation API
 *
 * Allows a patient (or authorized administrator) to revoke an active consent token,
 * immediately terminating clinical data sharing and recording an immutable HIPAA audit trail.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { revokeConsent } from '@/lib/services/ConsentVaultService';
import { extractClientIp } from '@/lib/middleware/verifyConsentToken';

export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { artifactId, reason } = body;

    if (!artifactId) {
      return NextResponse.json({ error: 'artifactId is required' }, { status: 400 });
    }

    const userId = session.user.id;
    const userRole = (session.user.role || 'PATIENT').toUpperCase();
    const clientIp = extractClientIp(request);
    const userAgent = request.headers?.get('user-agent') || 'Browser Client';

    const revoked = await revokeConsent({
      artifactId,
      revokedByUserId: userId,
      revokedByRole: userRole,
      reason: reason || 'Patient revoked consent via portal',
      auditContext: { clientIp, userAgent },
    });

    return NextResponse.json({
      success: true,
      message: 'Consent successfully revoked. Verification token invalidated.',
      artifact: {
        id: revoked.id,
        status: revoked.status,
        revoked_at: revoked.revoked_at,
        revocation_reason: revoked.revocation_reason,
      },
    });
  } catch (error) {
    console.error('POST /api/patient/consent/revoke error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to revoke consent artifact' },
      { status: error.status || 500 }
    );
  }
}

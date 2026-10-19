/**
 * app/api/patient/consent/grant/route.js
 *
 * ABDM Patient Consent Grant API
 *
 * GET:  List all currently active, valid consent artifacts for the authenticated patient.
 * POST: Patient grants access to a requested consent artifact (or issues a new verifiable token).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  grantConsent,
  requestConsent,
  getActiveConsentsForPatient,
  PURPOSE_CODES,
  DATA_TYPES,
} from '@/lib/services/ConsentVaultService';
import { extractClientIp } from '@/lib/middleware/verifyConsentToken';

// ─── GET: List Active Consents for Patient ─────────────────────────────────────

export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId') || session.user.patientId || session.user.id;

    // Check authorization: must be the patient or an admin
    const userRole = (session.user.role || '').toUpperCase();
    if (userRole === 'PATIENT' && session.user.patientId && session.user.patientId !== patientId) {
      return NextResponse.json({ error: 'Cannot view consents of another patient.' }, { status: 403 });
    }

    const activeConsents = await getActiveConsentsForPatient(patientId);

    return NextResponse.json({
      success: true,
      patientId,
      total: activeConsents.length,
      consents: activeConsents,
    });
  } catch (error) {
    console.error('GET /api/patient/consent/grant error:', error);
    return NextResponse.json({ error: 'Failed to retrieve active consents' }, { status: 500 });
  }
}

// ─── POST: Grant Consent Artifact ─────────────────────────────────────────────

export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const patientId = session.user.patientId || session.user.id;
    const clientIp = extractClientIp(request);
    const userAgent = request.headers?.get('user-agent') || 'Browser Client';
    const auditContext = { clientIp, userAgent };

    let artifact = null;

    // 1. Grant an existing REQUESTED artifact by ID
    if (body.artifactId) {
      artifact = await grantConsent({
        artifactId: body.artifactId,
        patientId,
        auditContext,
      });
    }
    // 2. Direct grant requested by the patient UI
    else if (body.accessorId) {
      const purposeCode = body.purposeCode || PURPOSE_CODES.CARE_MANAGEMENT;
      const dataTypes = Array.isArray(body.dataTypes) && body.dataTypes.length > 0
        ? body.dataTypes
        : [DATA_TYPES.DIAGNOSTIC_REPORT, DATA_TYPES.PRESCRIPTION];
      const durationHours = parseInt(body.durationHours || '24', 10);
      const ttlMs = durationHours * 60 * 60 * 1000;

      const requested = await requestConsent({
        patientId,
        requesterId: body.accessorId,
        requesterRole: body.accessorRole || 'DOCTOR',
        purposeCode,
        dataTypes,
        ttlMs,
        scopeRestriction: body.scopeRestriction || null,
        auditContext,
      });

      // Eagerly grant since it was initiated directly by the patient
      artifact = await grantConsent({
        artifactId: requested.id,
        patientId,
        auditContext,
      });
    } else {
      return NextResponse.json(
        { error: 'artifactId or accessorId is required to grant consent.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'ABHA cryptographically verified consent granted.',
      artifact: {
        id: artifact.id,
        status: artifact.status,
        token_jti: artifact.token_jti,
        token_signature: artifact.token_signature,
        expiry_timestamp: artifact.expiry_timestamp,
        granted_at: artifact.granted_at,
        data_types: artifact.data_types,
      },
    });
  } catch (error) {
    console.error('POST /api/patient/consent/grant error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to grant consent' },
      { status: error.status || 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { withAuth, withRoleGuard } from '@/lib/withRoleGuard';
import { withRLSContext } from '@/lib/rlsContext';
import prisma from '@/lib/prisma';
import { generateConsentToken } from '@/lib/consent';
import { logAudit } from '@/lib/audit';
import { pusherServer } from '@/lib/pusher';

// GET: Retrieve consents
export const GET = withAuth(async (request, session) => {
  try {
    const role = (session.user.role || '').toUpperCase();
    const patientId = session.user.patientId;
    const doctorId = session.user.doctorId;

    let consents = [];

    consents = await withRLSContext(session, async (tx) => {
      if (role === 'PATIENT' && patientId) {
        return tx.patientConsent.findMany({
          where: { patientId },
          orderBy: { createdAt: 'desc' }
        });
      } else if (role === 'DOCTOR' && doctorId) {
        return tx.patientConsent.findMany({
          where: {
            OR: [
              { accessorId: doctorId },
              { accessorId: '*' }
            ],
            status: 'ACTIVE',
            expiresAt: { gt: new Date() }
          },
          orderBy: { createdAt: 'desc' }
        });
      } else if (role === 'ADMIN') {
        return tx.patientConsent.findMany({
          orderBy: { createdAt: 'desc' }
        });
      } else {
        // General user or cashier, check consents granted to their user ID
        return tx.patientConsent.findMany({
          where: {
            accessorId: session.user.id
          },
          orderBy: { createdAt: 'desc' }
        });
      }
    });

    return NextResponse.json(consents);
  } catch (error) {
    console.error('GET /api/consent error:', error);
    return NextResponse.json({ error: 'Failed to fetch consents' }, { status: 500 });
  }
});

// POST: Create and sign new consent
// Only Patients, Doctors and Admins can create consent.
export const POST = withRoleGuard(['PATIENT', 'DOCTOR', 'ADMIN'], async (request, session) => {
  try {
    const { patientId, accessorId, accessorRole, accessLevel, durationHours } = await request.json();

    if (!patientId || !accessorId || !accessorRole || !accessLevel) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const sessionRole = (session.user.role || '').toUpperCase();
    if (sessionRole === 'PATIENT' && session.user.patientId !== patientId) {
      return NextResponse.json({ error: 'Forbidden: Cannot grant consent for another patient' }, { status: 403 });
    }

    const hours = parseInt(durationHours) || 24;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);

    // Generate cryptographic verification signature (HMAC)
    const token = generateConsentToken(patientId, accessorId, accessorRole, accessLevel, expiresAt);

    const consent = await withRLSContext(session, async (tx) => {
      return tx.patientConsent.create({
        data: {
          patientId,
          accessorId,
          accessorRole: accessorRole.toUpperCase(),
          accessLevel: accessLevel.toUpperCase(),
          consentToken: token,
          expiresAt,
          status: 'ACTIVE'
        }
      });
    });

    // Write to audit ledger
    await logAudit(
      session.user.id,
      session.user.name || 'System User',
      sessionRole,
      'PATIENT_GRANTED_CONSENT',
      patientId,
      {
        accessorId,
        accessorRole,
        accessLevel,
        expiresAt: expiresAt.toISOString(),
        consentId: consent.id
      }
    ).catch(e => console.error('Failed to log consent grant audit:', e));

    // Pusher real-time update trigger
    await pusherServer.trigger(`patient-${patientId}`, 'consent-updated', {
      patientId,
      accessorId,
      status: 'ACTIVE'
    }).catch(e => console.error('Pusher consent update notification failed:', e));

    // Also trigger update on doctor's channel if applicable
    if (accessorId !== '*') {
      await pusherServer.trigger(`doctor-${accessorId}`, 'consent-granted', {
        patientId,
        accessorId,
        accessLevel
      }).catch(e => console.error('Pusher doctor consent notification failed:', e));
    }

    return NextResponse.json({ success: true, consent }, { status: 201 });
  } catch (error) {
    console.error('POST /api/consent error:', error);
    return NextResponse.json({ error: 'Failed to create consent' }, { status: 500 });
  }
});

// PATCH: Revoke consent
export const PATCH = withAuth(async (request, session) => {
  try {
    const { consentId, action } = await request.json();

    if (!consentId || action !== 'REVOKE') {
      return NextResponse.json({ error: 'consentId and action = "REVOKE" are required' }, { status: 400 });
    }

    const consent = await prisma.patientConsent.findUnique({
      where: { id: consentId }
    });

    if (!consent) {
      return NextResponse.json({ error: 'Consent record not found' }, { status: 404 });
    }

    const sessionRole = (session.user.role || '').toUpperCase();
    
    // Authorization: Only the patient themselves or an Admin can revoke
    if (sessionRole === 'PATIENT' && session.user.patientId !== consent.patientId) {
      return NextResponse.json({ error: 'Forbidden: Cannot revoke another patient\'s consent' }, { status: 403 });
    }

    const updatedConsent = await withRLSContext(session, async (tx) => {
      return tx.patientConsent.update({
        where: { id: consentId },
        data: {
          status: 'REVOKED',
          revokedAt: new Date()
        }
      });
    });

    // Write to audit ledger
    await logAudit(
      session.user.id,
      session.user.name || 'System User',
      sessionRole,
      'PATIENT_REVOKED_CONSENT',
      consent.patientId,
      {
        accessorId: consent.accessorId,
        accessorRole: consent.accessorRole,
        accessLevel: consent.accessLevel,
        consentId: consent.id
      }
    ).catch(e => console.error('Failed to log consent revoke audit:', e));

    // Pusher update trigger
    await pusherServer.trigger(`patient-${consent.patientId}`, 'consent-updated', {
      patientId: consent.patientId,
      accessorId: consent.accessorId,
      status: 'REVOKED'
    }).catch(e => console.error('Pusher consent revoke notification failed:', e));

    if (consent.accessorId !== '*') {
      await pusherServer.trigger(`doctor-${consent.accessorId}`, 'consent-revoked', {
        patientId: consent.patientId,
        accessorId: consent.accessorId
      }).catch(e => console.error('Pusher doctor consent revoke notification failed:', e));
    }

    return NextResponse.json({ success: true, consent: updatedConsent });
  } catch (error) {
    console.error('PATCH /api/consent error:', error);
    return NextResponse.json({ error: 'Failed to revoke consent' }, { status: 500 });
  }
});


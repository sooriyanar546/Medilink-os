import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { generateConsentToken } from '@/lib/consent';
import { logAudit } from '@/lib/audit';
import { pusherServer } from '@/lib/pusher';

// GET: Retrieve consents
export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();
    const patientId = session.user.patientId;
    const doctorId = session.user.doctorId;

    let consents = [];

    if (role === 'PATIENT' && patientId) {
      consents = await prisma.patientConsent.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' }
      });
    } else if (role === 'DOCTOR' && doctorId) {
      consents = await prisma.patientConsent.findMany({
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
      consents = await prisma.patientConsent.findMany({
        orderBy: { createdAt: 'desc' }
      });
    } else {
      // General user or cashier, check consents granted to their user ID
      consents = await prisma.patientConsent.findMany({
        where: {
          accessorId: session.user.id
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    return NextResponse.json(consents);
  } catch (error) {
    console.error('GET /api/consent error:', error);
    return NextResponse.json({ error: 'Failed to fetch consents' }, { status: 500 });
  }
}

// POST: Create and sign new consent
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId, accessorId, accessorRole, accessLevel, durationHours } = await request.json();

    if (!patientId || !accessorId || !accessorRole || !accessLevel) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Verify requesting user is the patient themselves, a doctor, or an admin
    const sessionRole = session.user.role?.toUpperCase();
    if (sessionRole === 'PATIENT' && session.user.patientId !== patientId) {
      return NextResponse.json({ error: 'Forbidden: Cannot grant consent for another patient' }, { status: 403 });
    }

    const hours = parseInt(durationHours) || 24;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);

    // Generate cryptographic verification signature (HMAC)
    const token = generateConsentToken(patientId, accessorId, accessorRole, accessLevel, expiresAt);

    const consent = await prisma.patientConsent.create({
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
}

// PATCH: Revoke consent
export async function PATCH(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    const sessionRole = session.user.role?.toUpperCase();
    
    // Authorization: Only the patient themselves or an Admin can revoke
    if (sessionRole === 'PATIENT' && session.user.patientId !== consent.patientId) {
      return NextResponse.json({ error: 'Forbidden: Cannot revoke another patient\'s consent' }, { status: 403 });
    }

    const updatedConsent = await prisma.patientConsent.update({
      where: { id: consentId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date()
      }
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
}

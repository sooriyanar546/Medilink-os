import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { pusherServer } from '@/lib/pusher';

export async function POST(request) {
  try {
    const { patientId, medicationName = 'Amlodipine 5mg', delaySeconds = 30 } = await request.json();

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    const scheduledAt = new Date(Date.now() + delaySeconds * 1000);

    const reminder = await prisma.snoozedReminder.create({
      data: {
        patientId,
        medicationName,
        scheduledAt,
        status: 'PENDING',
        channel: 'WHATSAPP'
      }
    });

    // Write a HIPAA compliant Audit Log
    await logAudit(
      'system_patient_portal',
      'Patient Portal Interface',
      'PATIENT',
      'COMPLIANCE_WHATSAPP_SNOOZED',
      patientId,
      { durationSeconds: delaySeconds, scheduledAt }
    );

    // Trigger Pusher updates
    await pusherServer.trigger(`patient-${patientId}`, 'compliance-snoozed', {
      delayMinutes: delaySeconds / 60,
      scheduledAt
    });

    return NextResponse.json({ success: true, reminder });
  } catch (error) {
    console.error('POST /api/messages/snooze error:', error);
    return NextResponse.json({ error: 'Failed to snooze reminder' }, { status: 500 });
  }
}

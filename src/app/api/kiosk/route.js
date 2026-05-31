import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';
import { logAudit } from '@/lib/audit';

export async function POST(request) {
  try {
    const { phone, registerNew = false, name, dob, bloodGroup } = await request.json();

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    // Lookup patient by phone
    let patient = await prisma.patient.findUnique({
      where: { phone }
    });

    if (!patient) {
      if (registerNew) {
        if (!name || !dob) {
          return NextResponse.json({ error: 'Name and Date of Birth are required for registration.' }, { status: 400 });
        }
        
        // Create new patient record
        patient = await prisma.patient.create({
          data: {
            name,
            phone,
            dob: new Date(dob),
            bloodGroup: bloodGroup || 'O+',
          }
        });

        // Write registration to audit log
        await logAudit(
          patient.id,
          patient.name,
          'PATIENT_SELF_SERVICE',
          'PATIENT_REGISTERED_KIOSK',
          patient.id,
          { phone }
        );
      } else {
        return NextResponse.json({ error: 'Patient not found. Select "Register as New" to proceed.' }, { status: 404 });
      }
    }

    // Assign to a random doctor (or round-robin) for the kiosk flow
    const doctor = await prisma.doctor.findFirst();

    if (!doctor) {
      return NextResponse.json({ error: 'No doctors available.' }, { status: 500 });
    }

    // Get current queue position
    const lastInQueue = await prisma.visit.findFirst({
      where: {
        doctorId: doctor.id,
        status: { in: ['WAITING', 'CONSULTING'] },
      },
      orderBy: { queuePosition: 'desc' },
    });

    const nextPosition = (lastInQueue?.queuePosition ?? 0) + 1;

    const visit = await prisma.visit.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        reason: 'Kiosk Self Check-in',
        queuePosition: nextPosition,
        status: 'WAITING',
      },
      include: {
        patient: { select: { id: true, name: true } },
        doctor: { select: { id: true, name: true, specialization: true } },
      },
    });

    // Write to Immutable Audit Trail
    await logAudit(
      patient.id, 
      patient.name,
      'PATIENT_SELF_SERVICE',
      'KIOSK_CHECK_IN',
      patient.id,
      { visitId: visit.id }
    );

    // Trigger pusher event to notify Nurse Triage and Admin
    await pusherServer.trigger('hospital-queue', 'queue-updated', {}).catch(e => console.error(e));

    return NextResponse.json({ success: true, visit, waitTimeEstimate: nextPosition * 15 });
  } catch (error) {
    console.error('POST /api/kiosk error:', error);
    return NextResponse.json({ error: 'Failed to process check-in' }, { status: 500 });
  }
}

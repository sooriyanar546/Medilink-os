import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withRoleGuard } from '@/lib/withRoleGuard';
import { withRLSContext } from '@/lib/rlsContext';
import { logAudit } from '@/lib/audit';
import { unstable_cache, revalidateTag } from 'next/cache';

// GET /api/visits — Fetch the live queue for a specific doctor (or all doctors).
// Patients cannot view the queue. Doctors see only their own queue.
// Admin/Nurse see all queues.
export const GET = withRoleGuard(['ADMIN', 'NURSE', 'DOCTOR'], async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const userRole = (session.user.role || '').toUpperCase();

    // Doctors can only see their own queue — prevent lateral movement
    let doctorId = searchParams.get('doctorId');
    if (userRole === 'DOCTOR') {
      if (!session.user.doctorId) {
        return NextResponse.json(
          { error: 'Doctor profile not linked to this account.' },
          { status: 400 }
        );
      }
      doctorId = session.user.doctorId; // Override any client-supplied value
    }

    const status = searchParams.get('status');

    const visits = await withRLSContext(session, (tx) => {
      const whereClause = {
        ...(doctorId && { doctorId }),
        ...(status
          ? { status }
          : { status: { in: ['WAITING', 'CONSULTING'] } }),
      };
      return tx.visit.findMany({
        where: whereClause,
        include: {
          patient: { select: { id: true, name: true, phone: true, bloodGroup: true } },
          doctor: { select: { id: true, name: true, specialization: true } },
        },
        orderBy: { queuePosition: 'asc' },
      });
    });

    return NextResponse.json(visits);
  } catch (error) {
    console.error('GET /api/visits error:', error);
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }
});

// POST /api/visits — Check in a patient and add them to the live queue.
// Only Nurse and Admin can create new visits (patient check-in).
// Patients CANNOT self-inject into the queue.
export const POST = withRoleGuard(['ADMIN', 'NURSE', 'DOCTOR'], async (request, session) => {
  try {
    const body = await request.json();
    const { patientId, doctorId, reason, isCritical } = body;

    if (!patientId || !doctorId) {
      return NextResponse.json(
        { error: 'patientId and doctorId are required' },
        { status: 400 }
      );
    }

    // Atomic transaction: find last position and create visit in one DB round-trip.
    const visit = await withRLSContext(session, async (tx) => {
      const lastInQueue = await tx.visit.findFirst({
        where: {
          doctorId,
          status: { in: ['WAITING', 'CONSULTING'] },
        },
        orderBy: { queuePosition: 'desc' },
        select: { queuePosition: true },
      });

      const nextPosition = (lastInQueue?.queuePosition ?? 0) + 1;

      return tx.visit.create({
        data: {
          patientId,
          doctorId,
          reason: reason || null,
          queuePosition: nextPosition,
          isCritical: isCritical || false,
          status: 'WAITING',
        },
        include: {
          patient: { select: { id: true, name: true } },
          doctor: { select: { id: true, name: true, specialization: true } },
        },
      });
    });

    await logAudit(
      session.user.id,
      session.user.name || 'Staff',
      session.user.role?.toUpperCase(),
      'PATIENT_CHECKED_IN',
      patientId,
      {
        visitId: visit.id,
        doctorId,
        queuePosition: visit.queuePosition,
        isCritical,
      }
    ).catch(console.error);

    revalidateTag('visits-queue');
    return NextResponse.json(visit, { status: 201 });
  } catch (error) {
    console.error('POST /api/visits error:', error);
    return NextResponse.json({ error: 'Failed to create visit' }, { status: 500 });
  }
});

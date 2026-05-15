import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';

// PATCH /api/visits/[id]/complete — Doctor completes a consultation
// This is the core action that drives the "Sign & Next Patient" flow.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    // 1. Fetch the current visit
    const visit = await prisma.visit.findUnique({
      where: { id },
      include: { doctor: true },
    });

    if (!visit) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
    }

    if (visit.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Visit already completed' }, { status: 409 });
    }

    const now = new Date();

    // 2. Mark this visit as COMPLETED
    const completedVisit = await prisma.visit.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        waitTime: visit.consultedAt
          ? Math.round((now - new Date(visit.consultedAt)) / 60000)
          : null,
      },
    });

    // 2b. Sign Clinical Note and forward to pharmacy if it exists
    await prisma.clinicalNote.updateMany({
      where: { visitId: id },
      data: { 
        status: 'SIGNED',
        requiresPhysicianSignature: false
      }
    });

    // 3. Find and promote the next WAITING patient to CONSULTING
    const nextVisit = await prisma.visit.findFirst({
      where: {
        doctorId: visit.doctorId,
        status: 'WAITING',
      },
      orderBy: { queuePosition: 'asc' },
    });

    if (nextVisit) {
      await prisma.visit.update({
        where: { id: nextVisit.id },
        data: {
          status: 'CONSULTING',
          consultedAt: now,
        },
      });
    }

    // 4. Increment doctor's consultation count for today
    await prisma.doctor.update({
      where: { id: visit.doctorId },
      data: {
        consultationsToday: { increment: 1 },
      },
    });

    // 5. Update the daily hospital metric
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.hospitalMetric.upsert({
      where: { id: today.toISOString() }, // Use date as a stable ID
      update: {
        consultationCount: { increment: 1 },
        revenueProtected: { increment: 1500 }, // Average revenue per visit
      },
      create: {
        id: today.toISOString(),
        date: today,
        consultationCount: 1,
        revenueProtected: 1500,
      },
    });

    // Trigger pusher event
    await pusherServer.trigger('hospital-queue', 'queue-updated', {
      doctorId: visit.doctorId,
      completedVisitId: completedVisit.id,
      nextVisitId: nextVisit?.id || null
    }).catch(e => console.error("Pusher trigger failed:", e));

    return NextResponse.json({
      completedVisit,
      nextPatientId: nextVisit?.id || null,
      message: nextVisit
        ? `Next patient (${nextVisit.id}) is now consulting.`
        : 'Queue is now empty.',
    });

  } catch (error) {
    console.error('PATCH /api/visits/[id]/complete error:', error);
    return NextResponse.json({ error: 'Failed to complete visit' }, { status: 500 });
  }
}

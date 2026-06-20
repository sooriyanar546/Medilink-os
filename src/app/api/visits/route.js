import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { unstable_cache, revalidateTag } from 'next/cache';


// GET /api/visits — Fetch the live queue for a specific doctor (or all doctors)
// Cached for 5 seconds per query key to reduce DB load on high-frequency polling.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const doctorId = searchParams.get('doctorId');
    const status = searchParams.get('status');

    const getCachedVisits = unstable_cache(
      async () => {
        const whereClause = {
          ...(doctorId && { doctorId }),
          ...(status
            ? { status }
            : { status: { in: ['WAITING', 'CONSULTING'] } }),
        };
        return prisma.visit.findMany({
          where: whereClause,
          include: {
            patient: { select: { id: true, name: true, phone: true, bloodGroup: true } },
            doctor: { select: { id: true, name: true, specialization: true } },
          },
          orderBy: { queuePosition: 'asc' },
        });
      },
      [`visits-${doctorId || 'all'}-${status || 'live'}`],
      { revalidate: 5, tags: ['visits-queue'] }
    );

    const visits = await getCachedVisits();
    return NextResponse.json(visits);
  } catch (error) {
    console.error('GET /api/visits error:', error);
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }
}

// POST /api/visits — Check in a patient and add them to the live queue
export async function POST(request) {
  try {
    const body = await request.json();
    const { patientId, doctorId, reason, isCritical } = body;

    if (!patientId || !doctorId) {
      return NextResponse.json(
        { error: 'patientId and doctorId are required' },
        { status: 400 }
      );
    }

    // Atomic transaction: find last position and create visit in one DB round-trip
    // to prevent race conditions when two check-ins happen simultaneously.
    const visit = await prisma.$transaction(async (tx) => {
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


    // Bust the visits-queue cache so next GET returns fresh data immediately
    revalidateTag('visits-queue');

    return NextResponse.json(visit, { status: 201 });
  } catch (error) {
    console.error('POST /api/visits error:', error);
    return NextResponse.json({ error: 'Failed to create visit' }, { status: 500 });
  }
}

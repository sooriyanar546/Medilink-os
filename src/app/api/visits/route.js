import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/visits — Fetch the live queue for a specific doctor (or all doctors)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const doctorId = searchParams.get('doctorId');
    const status = searchParams.get('status'); // Optional filter by status

    const whereClause = {
      ...(doctorId && { doctorId }),
      ...(status
        ? { status }
        : { status: { in: ['WAITING', 'CONSULTING'] } }), // Default: live queue only
    };

    const visits = await prisma.visit.findMany({
      where: whereClause,
      include: {
        patient: {
          select: { id: true, name: true, phone: true, bloodGroup: true },
        },
        doctor: {
          select: { id: true, name: true, specialization: true },
        },
      },
      orderBy: { queuePosition: 'asc' },
    });

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

    // Get current queue position (next after last in queue)
    const lastInQueue = await prisma.visit.findFirst({
      where: {
        doctorId,
        status: { in: ['WAITING', 'CONSULTING'] },
      },
      orderBy: { queuePosition: 'desc' },
    });

    const nextPosition = (lastInQueue?.queuePosition ?? 0) + 1;

    const visit = await prisma.visit.create({
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

    return NextResponse.json(visit, { status: 201 });
  } catch (error) {
    console.error('POST /api/visits error:', error);
    return NextResponse.json({ error: 'Failed to create visit' }, { status: 500 });
  }
}

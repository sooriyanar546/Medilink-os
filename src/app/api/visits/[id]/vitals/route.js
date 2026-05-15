import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';

// PATCH /api/visits/[id]/vitals — Nurse saves patient vitals
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { bp, hr, temp, spo2 } = body;

    const updatedVisit = await prisma.visit.update({
      where: { id },
      data: {
        vitals: { bp, hr, temp, spo2 }
      },
    });

    // Notify doctor that vitals are ready
    await pusherServer.trigger('hospital-queue', 'vitals-updated', {
      visitId: id,
      vitals: updatedVisit.vitals
    }).catch(e => console.error("Pusher trigger failed:", e));

    return NextResponse.json({ success: true, visit: updatedVisit });
  } catch (error) {
    console.error('PATCH /api/visits/[id]/vitals error:', error);
    return NextResponse.json({ error: 'Failed to update vitals' }, { status: 500 });
  }
}

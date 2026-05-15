import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';

export async function GET() {
  try {
    // Fetch all notes that have medications and are SIGNED
    const notes = await prisma.clinicalNote.findMany({
      where: {
        status: 'SIGNED',
        NOT: { medications: { equals: [] } } // Only if they actually have meds
      },
      include: {
        visit: {
          include: {
            patient: { select: { id: true, name: true, phone: true } },
            doctor: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(notes);
  } catch (error) {
    console.error('GET /api/pharmacy error:', error);
    return NextResponse.json({ error: 'Failed to fetch prescriptions' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { noteId, pharmacyStatus } = await request.json();

    const updatedNote = await prisma.clinicalNote.update({
      where: { id: noteId },
      data: { pharmacyStatus },
      include: { visit: { include: { patient: true } } }
    });

    // Notify patient
    if (pharmacyStatus === 'READY') {
      await pusherServer.trigger(`patient-${updatedNote.visit.patientId}`, 'prescription-ready', {
        noteId: updatedNote.id,
        medications: updatedNote.medications
      }).catch(e => console.error("Pusher trigger failed:", e));
    }

    // Trigger hospital-wide pharmacy update
    await pusherServer.trigger('hospital-queue', 'pharmacy-updated', {}).catch(e => console.error("Pusher trigger failed:", e));

    return NextResponse.json({ success: true, note: updatedNote });
  } catch (error) {
    console.error('PATCH /api/pharmacy error:', error);
    return NextResponse.json({ error: 'Failed to update pharmacy status' }, { status: 500 });
  }
}

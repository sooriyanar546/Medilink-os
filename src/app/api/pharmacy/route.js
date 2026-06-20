import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';
import { logAudit } from '@/lib/audit';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();
    const patientId = session.user.patientId;

    let whereClause = {
      status: 'SIGNED',
      NOT: { medications: { equals: [] } }
    };

    if (role === 'PATIENT') {
      if (!patientId) {
        return NextResponse.json({ error: 'Patient ID missing from session' }, { status: 400 });
      }
      whereClause.visit = { patientId };
    } else if (role !== 'PHARMACIST' && role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch notes that have medications, are SIGNED, and match the role's filter
    const notes = await prisma.clinicalNote.findMany({
      where: whereClause,
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

    // Write to Immutable Audit Trail
    await logAudit(
      'pharmacy@medilink.com', 
      'Dr. Gregory (Pharmacy)',
      'PHARMACIST',
      `PHARMACY_${pharmacyStatus}`,
      updatedNote.visit.patientId,
      { noteId }
    );

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

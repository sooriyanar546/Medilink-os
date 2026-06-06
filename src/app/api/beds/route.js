import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { pusherServer } from '@/lib/pusher';

// GET: Retrieve all ward beds with associated patient information and their latest vital readings
export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const beds = await prisma.wardBed.findMany({
      include: {
        patient: {
          include: {
            visits: {
              orderBy: { checkInAt: 'desc' },
              take: 1
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    return NextResponse.json(beds);
  } catch (error) {
    console.error('GET /api/beds error:', error);
    return NextResponse.json({ error: 'Failed to fetch ward beds' }, { status: 500 });
  }
}

// POST: Allocate a patient to a bed or release a patient from a bed
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();
    if (!['ADMIN', 'DOCTOR', 'NURSE'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden: Insufficient clinical permissions' }, { status: 403 });
    }

    const { action, bedId, patientId } = await request.json();

    if (!action || !['ALLOCATE', 'RELEASE'].includes(action)) {
      return NextResponse.json({ error: 'Invalid or missing bed action' }, { status: 400 });
    }

    if (action === 'ALLOCATE') {
      if (!bedId || !patientId) {
        return NextResponse.json({ error: 'bedId and patientId are required for allocation' }, { status: 400 });
      }

      // Check if the bed exists
      const bed = await prisma.wardBed.findUnique({
        where: { id: bedId }
      });

      if (!bed) {
        return NextResponse.json({ error: 'Bed not found' }, { status: 404 });
      }

      if (bed.status !== 'AVAILABLE' && bed.patientId !== patientId) {
        return NextResponse.json({ error: 'Bed is currently occupied or unavailable' }, { status: 400 });
      }

      // Check if the patient exists
      const patient = await prisma.patient.findUnique({
        where: { id: patientId }
      });

      if (!patient) {
        return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      }

      // 1. Release the patient's existing bed if they are currently assigned to one
      const currentPatientBed = await prisma.wardBed.findFirst({
        where: { patientId: patientId, id: { not: bedId } }
      });

      if (currentPatientBed) {
        await prisma.wardBed.update({
          where: { id: currentPatientBed.id },
          data: {
            status: 'AVAILABLE',
            patientId: null,
            ventilator: false
          }
        });

        // Log the auto-release
        await logAudit(
          session.user.id,
          session.user.name || 'System User',
          role,
          'BED_RELEASED',
          patientId,
          {
            bedId: currentPatientBed.id,
            bedName: currentPatientBed.name,
            reason: 'Auto-released due to reallocation'
          }
        ).catch(e => console.error('Audit log failed:', e));
      }

      // 2. Perform the allocation
      const updatedBed = await prisma.wardBed.update({
        where: { id: bedId },
        data: {
          status: 'OCCUPIED',
          patientId: patientId
        },
        include: {
          patient: {
            include: {
              visits: {
                orderBy: { checkInAt: 'desc' },
                take: 1
              }
            }
          }
        }
      });

      // Log the bed allocation audit trail
      await logAudit(
        session.user.id,
        session.user.name || 'System User',
        role,
        'BED_ALLOCATED',
        patientId,
        {
          bedId: updatedBed.id,
          bedName: updatedBed.name,
          wardType: updatedBed.wardType
        }
      ).catch(e => console.error('Audit log failed:', e));

      // Dispatch real-time update using Pusher
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type: 'BED_ALLOCATED',
          bedId: updatedBed.id,
          patientId,
          bedName: updatedBed.name
        });
      } catch (pusherError) {
        console.error('Pusher notification failed:', pusherError);
      }

      return NextResponse.json({ success: true, bed: updatedBed });
    }

    if (action === 'RELEASE') {
      if (!bedId) {
        return NextResponse.json({ error: 'bedId is required for release' }, { status: 400 });
      }

      const bed = await prisma.wardBed.findUnique({
        where: { id: bedId }
      });

      if (!bed) {
        return NextResponse.json({ error: 'Bed not found' }, { status: 404 });
      }

      const assignedPatientId = bed.patientId;

      const updatedBed = await prisma.wardBed.update({
        where: { id: bedId },
        data: {
          status: 'AVAILABLE',
          patientId: null,
          ventilator: false
        }
      });

      // Log the bed release audit trail
      if (assignedPatientId) {
        await logAudit(
          session.user.id,
          session.user.name || 'System User',
          role,
          'BED_RELEASED',
          assignedPatientId,
          {
            bedId: updatedBed.id,
            bedName: updatedBed.name,
            wardType: updatedBed.wardType
          }
        ).catch(e => console.error('Audit log failed:', e));
      }

      // Dispatch real-time update using Pusher
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type: 'BED_RELEASED',
          bedId: updatedBed.id,
          patientId: assignedPatientId,
          bedName: updatedBed.name
        });
      } catch (pusherError) {
        console.error('Pusher notification failed:', pusherError);
      }

      return NextResponse.json({ success: true, bed: updatedBed });
    }
  } catch (error) {
    console.error('POST /api/beds error:', error);
    return NextResponse.json({ error: 'Failed to complete bed action' }, { status: 500 });
  }
}

// PATCH: Update bed auxiliary settings (ventilator, notes, status)
export async function PATCH(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();
    if (!['ADMIN', 'DOCTOR', 'NURSE'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden: Insufficient clinical permissions' }, { status: 403 });
    }

    const { bedId, ventilator, notes, status } = await request.json();

    if (!bedId) {
      return NextResponse.json({ error: 'bedId is required for patch operations' }, { status: 400 });
    }

    const bed = await prisma.wardBed.findUnique({
      where: { id: bedId }
    });

    if (!bed) {
      return NextResponse.json({ error: 'Bed not found' }, { status: 404 });
    }

    const updateData = {};
    if (ventilator !== undefined) updateData.ventilator = !!ventilator;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;

    const updatedBed = await prisma.wardBed.update({
      where: { id: bedId },
      data: updateData,
      include: {
        patient: {
          include: {
            visits: {
              orderBy: { checkInAt: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    // Log the bed settings modification
    await logAudit(
      session.user.id,
      session.user.name || 'System User',
      role,
      'BED_UPDATED',
      bed.patientId || null,
      {
        bedId: updatedBed.id,
        bedName: updatedBed.name,
        updates: updateData
      }
    ).catch(e => console.error('Audit log failed:', e));

    // Dispatch real-time update using Pusher
    try {
      await pusherServer.trigger('hospital-queue', 'queue-updated', {
        type: 'BED_UPDATED',
        bedId: updatedBed.id,
        patientId: bed.patientId
      });
    } catch (pusherError) {
      console.error('Pusher notification failed:', pusherError);
    }

    return NextResponse.json({ success: true, bed: updatedBed });
  } catch (error) {
    console.error('PATCH /api/beds error:', error);
    return NextResponse.json({ error: 'Failed to update bed configurations' }, { status: 500 });
  }
}

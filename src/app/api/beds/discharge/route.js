import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { pusherServer } from '@/lib/pusher';

// GET: Retrieve all active discharge tracking metrics and beds currently in maintenance
export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all occupied beds with patient and vital metrics
    const occupiedBeds = await prisma.wardBed.findMany({
      where: { status: 'OCCUPIED' },
      include: {
        patient: {
          include: {
            visits: {
              orderBy: { checkInAt: 'desc' },
              take: 1,
              include: {
                clinicalNote: true,
                billingClaim: true
              }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const dischargeTracker = occupiedBeds.map((bed) => {
      const patient = bed.patient;
      const activeVisit = patient?.visits?.[0];
      const clinicalNote = activeVisit?.clinicalNote;
      const billingClaim = activeVisit?.billingClaim;

      // 1. Clinical note signed off (Visit is completed or clinical note marked signed)
      const clinicalClearance = activeVisit?.status === 'COMPLETED' || clinicalNote?.status === 'SIGNED';

      // 2. Pharmacy medications dispensed (or no medications prescribed)
      let pharmacyClearance = false;
      if (!clinicalNote) {
        pharmacyClearance = false;
      } else {
        const meds = clinicalNote.medications;
        const hasMeds = Array.isArray(meds) && meds.length > 0;
        if (!hasMeds) {
          pharmacyClearance = true; // No meds to dispense
        } else {
          pharmacyClearance = clinicalNote.pharmacyStatus === 'DISPENSED';
        }
      }

      // 3. Billing claim settled
      const billingClearance = billingClaim?.paymentStatus === 'PAID' || billingClaim?.status === 'APPROVED';

      // 4. Transporter escort assigned
      const transporterClearance = bed.transporterAssigned;

      const readyForDischarge = clinicalClearance && pharmacyClearance && billingClearance && transporterClearance;

      return {
        bedId: bed.id,
        bedName: bed.name,
        wardType: bed.wardType,
        patientId: patient?.id,
        patientName: patient?.name || 'Unknown',
        visitId: activeVisit?.id,
        milestones: {
          clinicalClearance,
          pharmacyClearance,
          billingClearance,
          transporterClearance
        },
        readyForDischarge
      };
    });

    // Also fetch housekeeping stats for maintenance queue
    const maintenanceBeds = await prisma.wardBed.findMany({
      where: { status: 'MAINTENANCE' },
      orderBy: { maintenanceStart: 'asc' }
    });

    // Calculate daily average turnaround metrics if any
    const completedTurnarounds = await prisma.wardBed.findMany({
      where: { lastTurnaroundMins: { not: null } },
      select: { lastTurnaroundMins: true }
    });

    const totalTurnaround = completedTurnarounds.reduce((sum, b) => sum + (b.lastTurnaroundMins || 0), 0);
    const avgTurnaroundMins = completedTurnarounds.length > 0 
      ? Math.round(totalTurnaround / completedTurnarounds.length) 
      : 0;

    return NextResponse.json({
      dischargeTracker,
      maintenanceBeds,
      metrics: {
        avgTurnaroundMins,
        activeCleaningCount: maintenanceBeds.length,
        completedTurnaroundCount: completedTurnarounds.length
      }
    });
  } catch (error) {
    console.error('GET /api/beds/discharge error:', error);
    return NextResponse.json({ error: 'Failed to fetch discharge metrics' }, { status: 500 });
  }
}

// POST: Execute coordinated discharge and housekeeping actions
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

    const { action, bedId, cleanerName } = await request.json();

    if (!action || !bedId) {
      return NextResponse.json({ error: 'action and bedId are required' }, { status: 400 });
    }

    const bed = await prisma.wardBed.findUnique({
      where: { id: bedId }
    });

    if (!bed) {
      return NextResponse.json({ error: 'Bed not found' }, { status: 404 });
    }

    if (action === 'ASSIGN_TRANSPORTER') {
      const updatedBed = await prisma.wardBed.update({
        where: { id: bedId },
        data: { transporterAssigned: true }
      });

      // Audit Log
      await logAudit(
        session.user.id,
        session.user.name || 'System User',
        role,
        'DISCHARGE_TRANSPORTER_ASSIGNED',
        bed.patientId,
        { bedId, bedName: bed.name }
      ).catch(e => console.error(e));

      // Trigger Pusher
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type: 'TRANSPORTER_ASSIGNED',
          bedId
        });
      } catch (pusherError) {
        console.error(pusherError);
      }

      return NextResponse.json({ success: true, bed: updatedBed });
    }

    if (action === 'TRIGGER_DISCHARGE') {
      if (bed.status !== 'OCCUPIED' || !bed.patientId) {
        return NextResponse.json({ error: 'Bed is not occupied by any active patient' }, { status: 400 });
      }

      const dischargedPatientId = bed.patientId;

      // Update bed to enter maintenance cleaning cycle
      const updatedBed = await prisma.wardBed.update({
        where: { id: bedId },
        data: {
          status: 'MAINTENANCE',
          patientId: null,
          ventilator: false,
          transporterAssigned: false,
          maintenanceStart: new Date(),
          notes: 'Requires sanitization and turnaround servicing'
        }
      });

      // Audit Log for patient discharge and bed turnover start
      await logAudit(
        session.user.id,
        session.user.name || 'System User',
        role,
        'PATIENT_DISCHARGED',
        dischargedPatientId,
        { bedId, bedName: bed.name }
      ).catch(e => console.error(e));

      await logAudit(
        session.user.id,
        session.user.name || 'System User',
        role,
        'BED_TURNOVER_STARTED',
        null,
        { bedId, bedName: bed.name }
      ).catch(e => console.error(e));

      // Trigger Pusher
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type: 'PATIENT_DISCHARGED',
          bedId,
          patientId: dischargedPatientId
        });
      } catch (pusherError) {
        console.error(pusherError);
      }

      return NextResponse.json({ success: true, bed: updatedBed });
    }

    if (action === 'ASSIGN_CLEANER') {
      if (!cleanerName) {
        return NextResponse.json({ error: 'cleanerName is required to assign cleaning crew' }, { status: 400 });
      }

      const updatedBed = await prisma.wardBed.update({
        where: { id: bedId },
        data: {
          cleanerName,
          notes: `Cleaning in progress by ${cleanerName}`
        }
      });

      // Audit Log
      await logAudit(
        session.user.id,
        session.user.name || 'System User',
        role,
        'BED_CLEANER_ASSIGNED',
        null,
        { bedId, bedName: bed.name, cleanerName }
      ).catch(e => console.error(e));

      // Trigger Pusher
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type: 'CLEANER_ASSIGNED',
          bedId,
          cleanerName
        });
      } catch (pusherError) {
        console.error(pusherError);
      }

      return NextResponse.json({ success: true, bed: updatedBed });
    }

    if (action === 'COMPLETE_CLEANING') {
      if (bed.status !== 'MAINTENANCE') {
        return NextResponse.json({ error: 'Bed is not in maintenance' }, { status: 400 });
      }

      const start = bed.maintenanceStart ? new Date(bed.maintenanceStart) : new Date();
      const elapsedMs = new Date().getTime() - start.getTime();
      const turnaroundMins = Math.max(1, Math.round(elapsedMs / 60000));

      const updatedBed = await prisma.wardBed.update({
        where: { id: bedId },
        data: {
          status: 'AVAILABLE',
          cleanerName: null,
          maintenanceStart: null,
          lastTurnaroundMins: turnaroundMins,
          notes: 'Sanitized, inspected, and ready for allocation'
        }
      });

      // Audit Log
      await logAudit(
        session.user.id,
        session.user.name || 'System User',
        role,
        'BED_TURNOVER_COMPLETED',
        null,
        { bedId, bedName: bed.name, durationMins: turnaroundMins }
      ).catch(e => console.error(e));

      // Trigger Pusher
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type: 'CLEANING_COMPLETED',
          bedId,
          turnaroundMins
        });
      } catch (pusherError) {
        console.error(pusherError);
      }

      return NextResponse.json({ success: true, bed: updatedBed, turnaroundMins });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });
  } catch (error) {
    console.error('POST /api/beds/discharge error:', error);
    return NextResponse.json({ error: 'Failed to process discharge action' }, { status: 500 });
  }
}

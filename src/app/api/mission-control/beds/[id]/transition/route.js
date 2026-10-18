/**
 * app/api/mission-control/beds/[id]/transition/route.js
 *
 * POST /api/mission-control/beds/:id/transition
 *
 * Executes atomic, transactionally-locked bed state machine transitions.
 *
 * Valid state machine transitions:
 *   AVAILABLE   → OCCUPIED      (action: ALLOCATE)
 *   AVAILABLE   → RESERVED      (action: RESERVE)
 *   AVAILABLE   → MAINTENANCE   (action: TAKE_OFFLINE)
 *   OCCUPIED    → MAINTENANCE   (action: DISCHARGE)
 *   RESERVED    → OCCUPIED      (action: CONFIRM_RESERVATION)
 *   RESERVED    → AVAILABLE     (action: CANCEL_RESERVATION)
 *   MAINTENANCE → AVAILABLE     (action: RETURN_TO_SERVICE)
 *
 * All transitions use PostgreSQL row-level locking via Prisma's
 * $transaction + $executeRaw FOR UPDATE to prevent race conditions.
 *
 * Access: ADMIN, NURSE, DOCTOR
 * Validation: Zod schema (manual — Zod not installed, native validation used)
 */

import { NextResponse } from 'next/server';
import { withHipaaAudit } from '@/lib/middleware/hipaaAuditHook';
import prisma from '@/lib/prisma';
import { withRLSContext } from '@/lib/rlsContext';
import { pusherServer } from '@/lib/pusher';
import { revalidateTag } from 'next/cache';

// ── Valid transition matrix ───────────────────────────────────────────────────
const VALID_TRANSITIONS = {
  ALLOCATE:             { from: ['AVAILABLE', 'RESERVED'], to: 'OCCUPIED'    },
  RESERVE:              { from: ['AVAILABLE'],             to: 'RESERVED'     },
  TAKE_OFFLINE:         { from: ['AVAILABLE'],             to: 'MAINTENANCE'  },
  DISCHARGE:            { from: ['OCCUPIED'],              to: 'MAINTENANCE'  },
  CONFIRM_RESERVATION:  { from: ['RESERVED'],              to: 'OCCUPIED'     },
  CANCEL_RESERVATION:   { from: ['RESERVED'],              to: 'AVAILABLE'    },
  RETURN_TO_SERVICE:    { from: ['MAINTENANCE'],           to: 'AVAILABLE'    },
};

// ── Input validation (native — keeps zero new dependencies) ───────────────────
function validateTransitionInput(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return ['Request body must be a JSON object'];
  }

  const { action, patientId, ventilator, notes, overrideReason } = body;

  if (!action || typeof action !== 'string') {
    errors.push('action is required and must be a string');
  } else if (!VALID_TRANSITIONS[action]) {
    errors.push(`action must be one of: ${Object.keys(VALID_TRANSITIONS).join(', ')}`);
  }

  if (action === 'ALLOCATE' || action === 'CONFIRM_RESERVATION') {
    if (!patientId || typeof patientId !== 'string' || patientId.trim().length === 0) {
      errors.push(`patientId is required for action '${action}'`);
    }
  }

  if (ventilator !== undefined && typeof ventilator !== 'boolean') {
    errors.push('ventilator must be a boolean');
  }

  if (notes !== undefined && typeof notes !== 'string') {
    errors.push('notes must be a string');
  }

  return errors;
}

export const POST = withHipaaAudit(
  'BED_TRANSITION',
  ['ADMIN', 'NURSE', 'DOCTOR'],
  async (request, session, { params }) => {
    try {
      const { id: bedId } = await params;

      if (!bedId || typeof bedId !== 'string') {
        return NextResponse.json({ error: 'Bed ID parameter is required' }, { status: 400 });
      }

      const body = await request.json();
      const validationErrors = validateTransitionInput(body);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          { error: 'Validation failed', details: validationErrors },
          { status: 422 }
        );
      }

      const { action, patientId, ventilator, notes, overrideReason } = body;
      const transition = VALID_TRANSITIONS[action];
      const userRole = session.user.role.toUpperCase();

      // ── Transactional atomic bed lock + state machine ───────────────────────
      const result = await withRLSContext(session, async (tx) => {

        // Step 1: SELECT FOR UPDATE — acquires an exclusive row lock.
        // No other transaction can read or write this bed row until we COMMIT.
        // This prevents TOCTOU (time-of-check/time-of-use) race conditions.
        const lockedBeds = await tx.$queryRaw`
          SELECT id, status, "patientId", name, "wardType", ventilator, notes
          FROM "WardBed"
          WHERE id = ${bedId}
          FOR UPDATE NOWAIT
        `;

        if (!lockedBeds || lockedBeds.length === 0) {
          throw { code: 'BED_NOT_FOUND', status: 404, message: `Bed '${bedId}' not found` };
        }

        const bed = lockedBeds[0];

        // Step 2: Validate state machine transition
        if (!transition.from.includes(bed.status)) {
          throw {
            code: 'INVALID_TRANSITION',
            status: 409,
            message: `Cannot execute '${action}': bed '${bed.name}' is currently '${bed.status}'. Valid source states: ${transition.from.join(', ')}`,
          };
        }

        // Step 3: Validate patient exists for allocation actions
        let patient = null;
        if (patientId) {
          patient = await tx.patient.findUnique({
            where: { id: patientId },
            select: { id: true, name: true },
          });
          if (!patient) {
            throw { code: 'PATIENT_NOT_FOUND', status: 404, message: `Patient '${patientId}' not found` };
          }

          // Step 4: Auto-release any existing bed assignment for this patient
          const existingBed = await tx.wardBed.findFirst({
            where: { patientId, id: { not: bedId } },
            select: { id: true, name: true },
          });
          if (existingBed) {
            await tx.wardBed.update({
              where: { id: existingBed.id },
              data: { status: 'MAINTENANCE', patientId: null, ventilator: false, maintenanceStart: new Date() },
            });
          }
        }

        // Step 5: Build the update payload for the new state
        const updateData = {
          status: transition.to,
        };

        // Set/clear patientId based on action
        if (action === 'ALLOCATE' || action === 'CONFIRM_RESERVATION') {
          updateData.patientId = patientId;
          updateData.transporterAssigned = false;
        } else if (action === 'DISCHARGE') {
          updateData.patientId = null;
          updateData.ventilator = false;
          updateData.transporterAssigned = false;
          updateData.maintenanceStart = new Date();
          updateData.cleanerName = null;
        } else if (action === 'CANCEL_RESERVATION' || action === 'RETURN_TO_SERVICE') {
          updateData.patientId = null;
          updateData.maintenanceStart = null;
          updateData.cleanerName = null;
        } else if (action === 'TAKE_OFFLINE') {
          updateData.maintenanceStart = new Date();
        } else if (action === 'RESERVE') {
          updateData.patientId = patientId || null;
        }

        // Apply optional auxiliary fields
        if (ventilator !== undefined) updateData.ventilator = ventilator;
        if (notes !== undefined) updateData.notes = notes;

        // Step 6: Execute the state update (still within locked transaction)
        const updatedBed = await tx.wardBed.update({
          where: { id: bedId },
          data: updateData,
          include: {
            patient: { select: { id: true, name: true, bloodGroup: true } },
          },
        });

        return { updatedBed, previousStatus: bed.status };
      });

      // ── Post-transaction: Pusher broadcast + cache invalidation ────────────
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type: 'BED_TRANSITION',
          action,
          bedId,
          bedName: result.updatedBed.name,
          previousStatus: result.previousStatus,
          newStatus: result.updatedBed.status,
          patientId: patientId || null,
        });
      } catch (pusherError) {
        console.error('[BedTransition] Pusher trigger failed (non-critical):', pusherError.message);
      }

      revalidateTag('ward-beds');

      return NextResponse.json({
        success: true,
        transition: {
          action,
          from: result.previousStatus,
          to:   result.updatedBed.status,
        },
        bed: result.updatedBed,
      });

    } catch (err) {
      // Handle structured domain errors thrown from within the transaction
      if (err.code === 'BED_NOT_FOUND') {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err.code === 'INVALID_TRANSITION') {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err.code === 'PATIENT_NOT_FOUND') {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }

      // Handle PostgreSQL lock contention (NOWAIT raises 55P03)
      if (err.message?.includes('could not obtain lock') || err.code === '55P03') {
        return NextResponse.json(
          { error: 'Bed is currently being modified by another user. Please retry in a moment.' },
          { status: 409 }
        );
      }

      console.error('POST /api/mission-control/beds/[id]/transition error:', err);
      return NextResponse.json(
        { error: 'Failed to execute bed transition. The operation was rolled back.' },
        { status: 500 }
      );
    }
  }
);

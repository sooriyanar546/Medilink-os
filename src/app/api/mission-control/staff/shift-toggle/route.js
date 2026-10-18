/**
 * app/api/mission-control/staff/shift-toggle/route.js
 *
 * POST /api/mission-control/staff/shift-toggle
 *
 * Toggles a staff shift status through a controlled state machine.
 *
 * Valid state transitions:
 *   SCHEDULED → ON_DUTY       (action: CHECK_IN)
 *   ON_DUTY   → ON_BREAK      (action: START_BREAK)
 *   ON_BREAK  → ON_DUTY       (action: END_BREAK)
 *   ON_DUTY   → OFF_DUTY      (action: CHECK_OUT)
 *   SCHEDULED → ABSENT        (action: MARK_ABSENT)
 *   ABSENT    → SCHEDULED     (action: REINSTATE)
 *
 * Request Body:
 *   {
 *     shiftId: string    - StaffShift.id to update
 *     action:  string    - One of the valid actions above
 *     notes?:  string    - Optional notes (e.g. reason for absence)
 *   }
 *
 * Access: ADMIN only (only admins manage staff shift state)
 */

import { NextResponse } from 'next/server';
import { withHipaaAudit } from '@/lib/middleware/hipaaAuditHook';
import prisma from '@/lib/prisma';
import { withRLSContext } from '@/lib/rlsContext';
import { pusherServer } from '@/lib/pusher';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';

// ── Shift state machine ───────────────────────────────────────────────────────
const SHIFT_TRANSITIONS = {
  CHECK_IN:     { from: ['SCHEDULED', 'ON_BREAK'], to: 'ON_DUTY'    },
  START_BREAK:  { from: ['ON_DUTY'],               to: 'ON_BREAK'   },
  END_BREAK:    { from: ['ON_BREAK'],              to: 'ON_DUTY'    },
  CHECK_OUT:    { from: ['ON_DUTY', 'ON_BREAK'],   to: 'OFF_DUTY'   },
  MARK_ABSENT:  { from: ['SCHEDULED'],             to: 'ABSENT'     },
  REINSTATE:    { from: ['ABSENT'],                to: 'SCHEDULED'  },
};

// ── Input validation ──────────────────────────────────────────────────────────
function validateShiftToggleInput(body) {
  const errors = [];

  if (!body || typeof body !== 'object') return ['Request body must be a JSON object'];

  const { shiftId, action } = body;

  if (!shiftId || typeof shiftId !== 'string') {
    errors.push('shiftId is required and must be a string');
  }
  if (!action || typeof action !== 'string') {
    errors.push('action is required and must be a string');
  } else if (!SHIFT_TRANSITIONS[action]) {
    errors.push(`action must be one of: ${Object.keys(SHIFT_TRANSITIONS).join(', ')}`);
  }

  return errors;
}

export const POST = withHipaaAudit(
  'STAFF_SHIFT_TOGGLE',
  ['ADMIN'],
  async (request, session) => {

    // ── Rate limit: 60 shift toggles per minute ───────────────────────────
    const rl = checkRateLimit(request, { limit: 60, windowMs: 60_000, prefix: 'shift-toggle' });
    if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

    try {
      const body = await request.json();
      const validationErrors = validateShiftToggleInput(body);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          { error: 'Validation failed', details: validationErrors },
          { status: 422 }
        );
      }

      const { shiftId, action, notes } = body;
      const transition = SHIFT_TRANSITIONS[action];

      // ── Atomic shift state transition ──────────────────────────────────────
      const result = await withRLSContext(session, async (tx) => {

        // Fetch the current shift with a lock to prevent concurrent toggles
        const lockedShifts = await tx.$queryRaw`
          SELECT ss.id, ss.status, ss.ward, ss."staffId", ss."shiftStart", ss."shiftEnd",
                 sm.name AS "staffName", sm.role AS "staffRole", sm.department
          FROM   "StaffShift"  ss
          JOIN   "StaffMember" sm ON sm.id = ss."staffId"
          WHERE  ss.id = ${shiftId}
          FOR UPDATE NOWAIT
        `;

        if (!lockedShifts || lockedShifts.length === 0) {
          throw { code: 'SHIFT_NOT_FOUND', status: 404, message: `Shift '${shiftId}' not found` };
        }

        const shift = lockedShifts[0];

        // Validate the transition is allowed from the current status
        if (!transition.from.includes(shift.status)) {
          throw {
            code: 'INVALID_SHIFT_TRANSITION',
            status: 409,
            message: `Cannot execute '${action}': shift is currently '${shift.status}'. Valid source states: ${transition.from.join(', ')}`,
          };
        }

        // Apply the state transition
        const updateData = {
          status: transition.to,
          ...(notes !== undefined && { notes }),
        };

        const updatedShift = await tx.staffShift.update({
          where: { id: shiftId },
          data:  updateData,
          include: { staff: { select: { name: true, role: true, department: true } } },
        });

        // Also update the StaffMember.isActive if checking out permanently
        if (action === 'CHECK_OUT' || action === 'MARK_ABSENT') {
          // Just track the shift status — we don't deactivate the member record
          // isActive controls whether the member appears in rosters, not daily shift status
        }

        return { updatedShift, previousStatus: shift.status, staffName: shift.staffName };
      });

      // ── Pusher broadcast for real-time roster UI update ────────────────────
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type:           'STAFF_SHIFT_UPDATED',
          shiftId,
          action,
          previousStatus: result.previousStatus,
          newStatus:      result.updatedShift.status,
          ward:           result.updatedShift.ward,
        });
      } catch (pusherError) {
        console.error('[ShiftToggle] Pusher failed (non-critical):', pusherError.message);
      }

      return NextResponse.json({
        success: true,
        shift: {
          id:     result.updatedShift.id,
          ward:   result.updatedShift.ward,
          status: result.updatedShift.status,
          staff:  result.updatedShift.staff,
          notes:  result.updatedShift.notes,
        },
        transition: {
          action,
          from: result.previousStatus,
          to:   result.updatedShift.status,
        },
      });

    } catch (err) {
      // Structured domain errors
      if (err.code === 'SHIFT_NOT_FOUND') {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err.code === 'INVALID_SHIFT_TRANSITION') {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }

      // PostgreSQL lock contention
      if (err.message?.includes('could not obtain lock') || err.code === '55P03') {
        return NextResponse.json(
          { error: 'Shift is being updated by another user. Please retry in a moment.' },
          { status: 409 }
        );
      }

      console.error('POST /api/mission-control/staff/shift-toggle error:', err);
      return NextResponse.json(
        { error: 'Failed to update shift status. The operation was rolled back.' },
        { status: 500 }
      );
    }
  }
);

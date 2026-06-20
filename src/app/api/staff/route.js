import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';

/**
 * GET /api/staff
 * Returns all active staff members with their current shift status.
 * Admin and Doctor roles only.
 */
export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();
    if (!['ADMIN', 'DOCTOR', 'NURSE'].includes(role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const ward = searchParams.get('ward');
    const date = searchParams.get('date');

    const shiftDate = date ? new Date(date) : new Date();
    shiftDate.setHours(0, 0, 0, 0);
    const shiftDateEnd = new Date(shiftDate);
    shiftDateEnd.setHours(23, 59, 59, 999);

    const staff = await prisma.staffMember.findMany({
      where: {
        isActive: true,
        shifts: {
          some: {
            shiftStart: { gte: shiftDate },
            shiftEnd: { lte: shiftDateEnd },
            ...(ward && { ward }),
          },
        },
      },
      include: {
        shifts: {
          where: {
            shiftStart: { gte: shiftDate },
            shiftEnd: { lte: shiftDateEnd },
          },
          orderBy: { shiftStart: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(staff);
  } catch (error) {
    console.error('GET /api/staff error:', error);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

/**
 * POST /api/staff
 * Creates a new staff member or schedules a new shift.
 * Admin only.
 */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();
    if (role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Rate limit: max 30 staff operations per admin per minute
    const rl = checkRateLimit(request, { limit: 30, windowMs: 60_000, prefix: 'staff-write' });
    if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

    const body = await request.json();
    const { action } = body;

    if (action === 'CREATE_MEMBER') {
      const { name, role: staffRole, department, phone, email, employeeCode } = body;
      if (!name || !staffRole || !department || !employeeCode) {
        return NextResponse.json(
          { error: 'name, role, department, and employeeCode are required' },
          { status: 400 }
        );
      }

      const member = await prisma.staffMember.create({
        data: { name, role: staffRole, department, phone, email, employeeCode },
      });

      return NextResponse.json({ success: true, member }, { status: 201 });
    }

    if (action === 'SCHEDULE_SHIFT') {
      const { staffId, ward, shiftStart, shiftEnd, notes } = body;
      if (!staffId || !ward || !shiftStart || !shiftEnd) {
        return NextResponse.json(
          { error: 'staffId, ward, shiftStart, and shiftEnd are required' },
          { status: 400 }
        );
      }

      const shift = await prisma.staffShift.create({
        data: {
          staffId,
          ward,
          shiftStart: new Date(shiftStart),
          shiftEnd: new Date(shiftEnd),
          notes,
          status: 'SCHEDULED',
        },
        include: { staff: { select: { name: true, role: true } } },
      });

      return NextResponse.json({ success: true, shift }, { status: 201 });
    }

    if (action === 'UPDATE_SHIFT_STATUS') {
      const { shiftId, status } = body;
      if (!shiftId || !status) {
        return NextResponse.json({ error: 'shiftId and status are required' }, { status: 400 });
      }

      const shift = await prisma.staffShift.update({
        where: { id: shiftId },
        data: { status },
        include: { staff: { select: { name: true, role: true } } },
      });

      return NextResponse.json({ success: true, shift });
    }

    return NextResponse.json({ error: 'Invalid action. Use CREATE_MEMBER, SCHEDULE_SHIFT, or UPDATE_SHIFT_STATUS' }, { status: 400 });
  } catch (error) {
    console.error('POST /api/staff error:', error);
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Staff member with this email or employee code already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to complete staff operation' }, { status: 500 });
  }
}

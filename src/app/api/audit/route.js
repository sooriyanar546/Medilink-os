import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();
    const patientId = session.user.patientId;

    let logs = [];
    if (role === 'PATIENT' && patientId) {
      logs = await prisma.auditLog.findMany({
        where: { patientId },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    } else if (role === 'ADMIN') {
      logs = await prisma.auditLog.findMany({
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(logs);
  } catch (error) {
    console.error('GET /api/audit error:', error);
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}

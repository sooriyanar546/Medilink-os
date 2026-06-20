import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

// GET /api/metrics — Live operational metrics for the Admin Command Center
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role?.toUpperCase();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch today's metric snapshot
    const todayMetric = await prisma.hospitalMetric.findFirst({
      where: { date: { gte: today } },
      orderBy: { date: 'desc' },
    });

    // Count live queue
    const liveQueueCount = await prisma.visit.count({
      where: { status: { in: ['WAITING', 'CONSULTING'] } },
    });

    // Count flagged billing claims
    const flaggedClaims = await prisma.billingClaim.count({
      where: { status: 'FLAGGED' },
    });

    const isAdmin = role === 'ADMIN';

    return NextResponse.json({
      totalActivePatients: liveQueueCount,
      consultationCount: todayMetric?.consultationCount ?? 0,
      revenueProtected: isAdmin ? (todayMetric?.revenueProtected ?? 0) : 0,
      experienceScore: todayMetric?.experienceScore ?? 100,
      flaggedClaims: isAdmin ? flaggedClaims : 0,
    });
  } catch (error) {
    console.error('GET /api/metrics error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}

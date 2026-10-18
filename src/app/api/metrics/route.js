import { NextResponse } from 'next/server';
import { withRoleGuard } from '@/lib/withRoleGuard';
import { withRLSContext } from '@/lib/rlsContext';
import prisma from '@/lib/prisma';

// GET /api/metrics — Live operational metrics for the Admin Command Center
export const GET = withRoleGuard(['ADMIN', 'NURSE', 'DOCTOR'], async (request, session) => {
  try {
    const role = (session.user.role || '').toUpperCase();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const data = await withRLSContext(session, async (tx) => {
      // Fetch today's metric snapshot
      const todayMetric = await tx.hospitalMetric.findFirst({
        where: { date: { gte: today } },
        orderBy: { date: 'desc' },
      });

      // Count live queue
      const liveQueueCount = await tx.visit.count({
        where: { status: { in: ['WAITING', 'CONSULTING'] } },
      });

      // Count flagged billing claims
      const flaggedClaims = await tx.billingClaim.count({
        where: { status: 'FLAGGED' },
      });

      // Count completed consultations today as fallback
      const completedToday = await tx.visit.count({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: today },
        },
      });

      // Sum revenue from approved claims as fallback
      const paidClaimsAgg = await tx.billingClaim.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { amount: true },
      });

      const isAdmin = role === 'ADMIN';
      const consultationCount = todayMetric?.consultationCount ?? completedToday;
      const revenueProtected = todayMetric?.revenueProtected ?? (paidClaimsAgg._sum.amount || 0);

      return {
        totalActivePatients: liveQueueCount,
        consultationCount,
        revenueProtected: isAdmin ? revenueProtected : 0,
        experienceScore: todayMetric?.experienceScore ?? 100,
        flaggedClaims: isAdmin ? flaggedClaims : 0,
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/metrics error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
});


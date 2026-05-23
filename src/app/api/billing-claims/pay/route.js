import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';

export async function POST(request) {
  try {
    const { claimId } = await request.json();

    const updatedClaim = await prisma.billingClaim.update({
      where: { id: claimId },
      data: {
        paymentStatus: 'PAID',
        status: 'APPROVED',
        resolvedAt: new Date(),
      },
      include: {
        visit: {
          include: { patient: true }
        }
      }
    });

    // Notify Patient via Pusher
    await pusherServer.trigger(`patient-${updatedClaim.visit.patientId}`, 'payment-received', {
      claimId: updatedClaim.id,
      amount: updatedClaim.amount
    }).catch(e => console.error("Pusher trigger failed:", e));

    return NextResponse.json({ success: true, claim: updatedClaim });
  } catch (error) {
    console.error('POST /api/billing-claims/pay error:', error);
    return NextResponse.json({ error: 'Failed to process payment' }, { status: 500 });
  }
}

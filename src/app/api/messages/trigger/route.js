import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';

// POST /api/messages/trigger
// Simulates an automated hospital communication
export async function POST(request) {
  try {
    const { patientId, content, channel = 'WHATSAPP' } = await request.json();

    if (!patientId || !content) {
      return NextResponse.json({ error: 'patientId and content are required' }, { status: 400 });
    }

    const message = await prisma.message.create({
      data: {
        patientId,
        content,
        channel,
        deliveryStatus: 'DELIVERED', // Simulate instantaneous delivery for demo
      },
    });

    await pusherServer.trigger(`patient-${patientId}`, 'message-received', message).catch(e => console.error("Pusher trigger failed:", e));

    return NextResponse.json({ success: true, message });
  } catch (error) {
    console.error('POST /api/messages/trigger error:', error);
    return NextResponse.json({ error: 'Failed to trigger message' }, { status: 500 });
  }
}

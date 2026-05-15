import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/messages?patientId=...
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    const messages = await prisma.message.findMany({
      where: { patientId },
      orderBy: { sentAt: 'desc' },
    });

    return NextResponse.json(messages);
  } catch (error) {
    console.error('GET /api/messages error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

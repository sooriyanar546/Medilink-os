import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/patients — Fetch all patients (for admin search)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    const patients = await prisma.patient.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { abhaId: { contains: search } },
        ],
      },
      include: {
        visits: {
          orderBy: { checkInAt: 'desc' },
          take: 1, // Include most recent visit
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(patients);
  } catch (error) {
    console.error('GET /api/patients error:', error);
    return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
  }
}

// POST /api/patients — Register a new patient
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, dob, phone, email, abhaId, bloodGroup } = body;

    if (!name || !dob || !phone) {
      return NextResponse.json(
        { error: 'name, dob, and phone are required' },
        { status: 400 }
      );
    }

    const patient = await prisma.patient.create({
      data: {
        name,
        dob: new Date(dob),
        phone,
        email: email || null,
        abhaId: abhaId || null,
        bloodGroup: bloodGroup || null,
      },
    });

    return NextResponse.json(patient, { status: 201 });
  } catch (error) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'A patient with this phone number or ABHA ID already exists' },
        { status: 409 }
      );
    }
    console.error('POST /api/patients error:', error);
    return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 });
  }
}

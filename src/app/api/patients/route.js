import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withRoleGuard } from '@/lib/withRoleGuard';
import { withRLSContext } from '@/lib/rlsContext';
import { logAudit } from '@/lib/audit';

// GET /api/patients — Staff search endpoint (Admin, Nurse, Doctor only)
// Patients must use GET /api/patients/[id] for their own profile.
export const GET = withRoleGuard(['ADMIN', 'NURSE', 'DOCTOR'], async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    const patients = await withRLSContext(session, (tx) =>
      tx.patient.findMany({
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
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    );

    // Audit data access for HIPAA compliance
    await logAudit(
      session.user.id,
      session.user.name || 'Staff',
      session.user.role?.toUpperCase(),
      'PATIENT_LIST_ACCESSED',
      null,
      { searchTerm: search, resultCount: patients.length }
    ).catch(console.error);

    return NextResponse.json(patients);
  } catch (error) {
    console.error('GET /api/patients error:', error);
    return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
  }
});

// POST /api/patients — Register a new patient (Admin and Nurse only)
// Patients self-register via /api/auth/signup (which creates User + Patient together).
export const POST = withRoleGuard(['ADMIN', 'NURSE'], async (request, session) => {
  try {
    const body = await request.json();
    const { name, dob, phone, email, abhaId, bloodGroup } = body;

    if (!name || !dob || !phone) {
      return NextResponse.json(
        { error: 'name, dob, and phone are required' },
        { status: 400 }
      );
    }

    const patient = await withRLSContext(session, (tx) =>
      tx.patient.create({
        data: {
          name,
          dob: new Date(dob),
          phone,
          email: email || null,
          abhaId: abhaId || null,
          bloodGroup: bloodGroup || null,
        },
      })
    );

    await logAudit(
      session.user.id,
      session.user.name || 'Staff',
      session.user.role?.toUpperCase(),
      'PATIENT_REGISTERED',
      patient.id,
      { registeredBy: session.user.id, patientName: name }
    ).catch(console.error);

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
});

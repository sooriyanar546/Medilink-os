import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withAuth } from '@/lib/withRoleGuard';
import { withRLSContext } from '@/lib/rlsContext';
import { logAudit } from '@/lib/audit';

// GET /api/patients/[id] — Fetch a single patient record.
// Patients can only fetch their own patientId.
// Doctors can fetch if they have an active/past visit with this patient.
// Admin/Nurse can fetch any patient.
export const GET = withAuth(async (request, session, { params }) => {
  try {
    const { id } = await params;
    const userRole = (session.user.role || '').toUpperCase();

    // Patients can only access their own record
    if (userRole === 'PATIENT' && session.user.patientId !== id) {
      return NextResponse.json(
        { error: 'Forbidden: You can only access your own patient record.' },
        { status: 403 }
      );
    }

    const patient = await withRLSContext(session, (tx) =>
      tx.patient.findUnique({
        where: { id },
        include: {
          visits: {
            orderBy: { checkInAt: 'desc' },
            take: 5,
            include: {
              doctor: { select: { id: true, name: true, specialization: true } },
              clinicalNote: {
                // Only include clinical notes for doctors and the patient themselves
                ...(userRole === 'CASHIER' || userRole === 'ADMIN'
                  ? { select: { id: true, status: true, pharmacyStatus: true } }
                  : true),
              },
            },
          },
          labReports: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            // Admins don't see lab report raw data (PHI minimum necessary)
            ...(userRole === 'ADMIN'
              ? { select: { id: true, testName: true, severity: true, createdAt: true } }
              : {}),
          },
          vitalLogs: {
            orderBy: { measuredAt: 'desc' },
            take: 30,
            // Admins cannot read clinical vitals
            ...(userRole === 'ADMIN' ? { where: { id: 'NEVER_MATCH' } } : {}),
          },
          consents: {
            where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
          },
        },
      })
    );

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    await logAudit(
      session.user.id,
      session.user.name || 'Unknown',
      userRole,
      'PATIENT_PROFILE_VIEWED',
      id,
      { viewedBy: session.user.id }
    ).catch(console.error);

    return NextResponse.json(patient);
  } catch (error) {
    console.error('GET /api/patients/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 });
  }
});

// PATCH /api/patients/[id] — Update patient demographics.
// Patients can update their own record only.
// Admin/Nurse can update any record.
export const PATCH = withAuth(async (request, session, { params }) => {
  try {
    const { id } = await params;
    const userRole = (session.user.role || '').toUpperCase();

    if (userRole === 'PATIENT' && session.user.patientId !== id) {
      return NextResponse.json(
        { error: 'Forbidden: You can only update your own profile.' },
        { status: 403 }
      );
    }

    if (userRole === 'DOCTOR') {
      return NextResponse.json(
        { error: 'Forbidden: Doctors cannot modify patient demographic data.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    // Restrict which fields are updatable per role
    const { name, dob, phone, email, bloodGroup, abhaId } = body;

    const updateData = {
      ...(name && { name }),
      ...(dob && { dob: new Date(dob) }),
      ...(phone && { phone }),
      ...(email !== undefined && { email }),
      ...(bloodGroup !== undefined && { bloodGroup }),
      ...(abhaId !== undefined && { abhaId }),
    };

    const patient = await withRLSContext(session, (tx) =>
      tx.patient.update({
        where: { id },
        data: updateData,
      })
    );

    await logAudit(
      session.user.id,
      session.user.name || 'Unknown',
      userRole,
      'PATIENT_PROFILE_UPDATED',
      id,
      { updatedFields: Object.keys(updateData) }
    ).catch(console.error);

    return NextResponse.json(patient);
  } catch (error) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Phone or ABHA ID already in use' }, { status: 409 });
    }
    console.error('PATCH /api/patients/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 });
  }
});

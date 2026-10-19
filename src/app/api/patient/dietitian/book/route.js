/**
 * app/api/patient/dietitian/book/route.js
 *
 * Clinical Nutrition & Dietitian Consultation Booking API
 *
 * GET:  Retrieve patient's active nutrition plan, recommended protocols, and dietitian slots.
 * POST: Book a confirmed consultation slot with double-booking prevention.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import {
  resolveProtocol,
  createNutritionPlan,
  bookDietitianAppointment,
  getDietitianAvailability,
  getActiveNutritionPlan,
  getProtocolData,
  NUTRITION_PROTOCOLS,
} from '@/lib/services/ClinicalDietService';
import { logAudit } from '@/lib/audit';

// Pre-configured MediLink hospital dietitians
const HOSPITAL_DIETITIANS = [
  {
    id: 'dt_ananya_sen',
    name: 'Dr. Ananya Sen, RD',
    qualification: 'M.Sc. Clinical Nutrition, Registered Dietitian',
    specialty: 'Cardiovascular Health, DASH & Hypertension Protocols',
    department: 'Dietetics & Preventative Cardiology — Room 112',
    modes: ['IN_PERSON', 'TELEHEALTH'],
    rating: 4.9,
    slots: ['10:30', '14:00', '16:30'],
  },
  {
    id: 'dt_marcus_vance',
    name: 'Marcus Vance, PhD, CNS',
    qualification: 'Certified Nutrition Specialist, Renal Nutritionist',
    specialty: 'Renal (CKD) & Diabetic Medical Nutrition Therapy',
    department: 'Metabolic & Renal Clinic — Suite 402',
    modes: ['IN_PERSON', 'TELEHEALTH'],
    rating: 4.8,
    slots: ['11:00', '13:30', '15:00'],
  },
];

// ─── GET: Nutrition Plan & Dietitian Availability ─────────────────────────────

export async function GET(request) {
  try {
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId') || session?.user?.patientId || session?.user?.id || 'pt_patient';
    const protocolCode = searchParams.get('protocol');
    const dietitianId = searchParams.get('dietitianId');

    // 1. Fetch active nutrition plan
    let activePlan = null;
    try {
      activePlan = await getActiveNutritionPlan(patientId);
    } catch {
      // Table may not yet be populated
    }

    // 2. Fetch specific protocol guidelines if requested
    let protocolDetails = null;
    if (protocolCode) {
      protocolDetails = getProtocolData(protocolCode);
    } else if (activePlan?.protocol) {
      protocolDetails = getProtocolData(activePlan.protocol);
    }

    // 3. Resolve recommended protocol based on patient diagnoses
    let conditionList = [];
    try {
      const recentNote = await prisma.clinicalNote?.findFirst?.({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      });
      if (recentNote?.assessment) conditionList.push(recentNote.assessment);
      if (recentNote?.subjective) conditionList.push(recentNote.subjective);
    } catch {}

    const resolved = resolveProtocol(conditionList);

    // 4. Fetch availability if specific dietitian query
    let availability = null;
    if (dietitianId) {
      const queryDate = searchParams.get('date') ? new Date(searchParams.get('date')) : new Date();
      try {
        availability = await getDietitianAvailability(dietitianId, queryDate);
      } catch {}
    }

    return NextResponse.json({
      success: true,
      patientId,
      activePlan,
      protocolDetails: protocolDetails || getProtocolData(resolved.primary),
      recommendedProtocol: resolved,
      dietitians: HOSPITAL_DIETITIANS,
      availability,
    });
  } catch (error) {
    console.error('GET /api/patient/dietitian/book error:', error);
    return NextResponse.json({ error: 'Failed to retrieve clinical diet information' }, { status: 500 });
  }
}

// ─── POST: Book Dietitian Appointment ─────────────────────────────────────────

export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const patientId = body.patientId || session.user.patientId || session.user.id;
    const {
      dietitianId,
      dietitianName,
      slotStart,
      slotEnd,
      mode = 'IN_PERSON',
      notes = null,
      conditions = [],
      createPlan = true,
    } = body;

    if (!dietitianName || !slotStart) {
      return NextResponse.json(
        { error: 'dietitianName and slotStart are required fields.' },
        { status: 400 }
      );
    }

    const start = new Date(slotStart);
    const end = slotEnd ? new Date(slotEnd) : new Date(start.getTime() + 45 * 60 * 1000); // 45-min default

    // Validate date format
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid slotStart or slotEnd timestamp format.' }, { status: 422 });
    }

    if (start <= new Date()) {
      return NextResponse.json({ error: 'Appointment slot must be scheduled in the future.' }, { status: 422 });
    }

    // Optionally create or attach a clinical nutrition plan
    let nutritionPlanId = body.nutritionPlanId || null;
    let createdPlan = null;

    if (!nutritionPlanId && createPlan) {
      try {
        const resolved = resolveProtocol(conditions);
        createdPlan = await createNutritionPlan({
          patientId,
          prescribedBy: session.user.id,
          conditions: conditions.length > 0 ? conditions : ['General Wellness'],
          protocolOverride: resolved.primary,
        });
        nutritionPlanId = createdPlan.id;
      } catch (planErr) {
        console.warn('[patient/dietitian/book] Plan creation non-fatal:', planErr?.message);
      }
    }

    // Book appointment with double-booking prevention
    const appointment = await bookDietitianAppointment({
      patientId,
      nutritionPlanId,
      dietitianId: dietitianId || 'dt_hospital_dietitian',
      dietitianName,
      slotStart: start,
      slotEnd: end,
      mode,
      notes,
    });

    logAudit(
      session.user.id,
      session.user.name || 'Patient',
      session.user.role || 'PATIENT',
      'DIETITIAN_APPOINTMENT_BOOKED',
      patientId,
      {
        dietitianName,
        slotStart: start.toISOString(),
        mode,
      }
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Appointment confirmed with ${dietitianName}`,
      appointment,
      nutritionPlan: createdPlan,
    });
  } catch (error) {
    console.error('POST /api/patient/dietitian/book error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to book dietitian appointment' },
      { status: error.status || 500 }
    );
  }
}

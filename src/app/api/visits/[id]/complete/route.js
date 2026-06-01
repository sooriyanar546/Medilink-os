import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pusherServer } from '@/lib/pusher';
import { logAudit } from '@/lib/audit';

// PATCH /api/visits/[id]/complete — Doctor completes a consultation
// This is the core action that drives the "Sign & Next Patient" flow.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    // 1. Fetch the current visit
    const visit = await prisma.visit.findUnique({
      where: { id },
      include: { doctor: true },
    });

    if (!visit) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
    }

    if (visit.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Visit already completed' }, { status: 409 });
    }

    const now = new Date();

    // 2. Mark this visit as COMPLETED
    const completedVisit = await prisma.visit.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        waitTime: visit.consultedAt
          ? Math.round((now - new Date(visit.consultedAt)) / 60000)
          : null,
      },
    });

    // 2b. Sign Clinical Note and forward to pharmacy if it exists
    await prisma.clinicalNote.updateMany({
      where: { visitId: id },
      data: { 
        status: 'SIGNED',
        requiresPhysicianSignature: false
      }
    });

    // 2c. Automatically Generate Intelligent AI-Audited Billing Claim
    try {
      const clinicalNote = await prisma.clinicalNote.findFirst({
        where: { visitId: id }
      });
      
      let amountVal = 150.00;
      let rejectionRisk = 0;
      let missingDocs = [];
      
      if (clinicalNote) {
        const diagText = (clinicalNote.assessment || "").toLowerCase();
        const rawMeds = clinicalNote.medications;
        const meds = Array.isArray(rawMeds) ? rawMeds : [];
        
        meds.forEach(m => {
          const drug = (m.drugName || m.name || "").toLowerCase();
          if (drug.includes("amlodipine")) amountVal += 35.00;
          else if (drug.includes("paracetamol") || drug.includes("acetaminophen")) amountVal += 15.00;
          else if (drug.includes("sumatriptan")) amountVal += 75.00;
          else if (drug.includes("ibuprofen")) amountVal += 20.00;
          else amountVal += 30.00;
        });
        
        // Replicated Compliance Rules
        if (diagText.includes("palpitations") || diagText.includes("cardiac")) {
          const hasHolter = (clinicalNote.plan || "").toLowerCase().includes("holter") || 
                            (clinicalNote.plan || "").toLowerCase().includes("ecg");
          if (!hasHolter) {
            rejectionRisk += 35;
            missingDocs.push("Ambulatory Holter ECG justification for palpitations.");
          }
        }
        
        if (diagText.includes("hypertension") || diagText.includes("blood pressure")) {
          const hasAmlodipine = meds.some(m => (m.drugName || m.name || "").toLowerCase().includes("amlodipine"));
          if (!hasAmlodipine) {
            rejectionRisk += 25;
            missingDocs.push("Standard anti-hypertensive (Amlodipine) medication prescription.");
          }
        }
        
        const hasSumatriptan = meds.some(m => (m.drugName || m.name || "").toLowerCase().includes("sumatriptan"));
        if (hasSumatriptan && !diagText.includes("migraine")) {
          rejectionRisk += 40;
          missingDocs.push("Migraine primary diagnosis to justify Sumatriptan.");
        }
      }
      
      await prisma.billingClaim.upsert({
        where: { visitId: id },
        update: {
          amount: amountVal,
          rejectionRisk,
          missingDocs,
          status: rejectionRisk > 30 ? 'FLAGGED' : 'PENDING'
        },
        create: {
          visitId: id,
          amount: amountVal,
          tpaName: "National Health Insurance",
          rejectionRisk,
          missingDocs,
          status: rejectionRisk > 30 ? 'FLAGGED' : 'PENDING'
        }
      });
      console.log(`📡 [Revenue Shield] Automatically generated billing claim for visit ${id} (Risk: ${rejectionRisk}%)`);
    } catch (claimErr) {
      console.error("❌ Failed to automatically generate billing claim inside complete route:", claimErr);
    }

    // 3. Find and promote the next WAITING patient to CONSULTING
    const nextVisit = await prisma.visit.findFirst({
      where: {
        doctorId: visit.doctorId,
        status: 'WAITING',
      },
      orderBy: { queuePosition: 'asc' },
    });

    if (nextVisit) {
      await prisma.visit.update({
        where: { id: nextVisit.id },
        data: {
          status: 'CONSULTING',
          consultedAt: now,
        },
      });
    }

    // 4. Increment doctor's consultation count for today
    await prisma.doctor.update({
      where: { id: visit.doctorId },
      data: {
        consultationsToday: { increment: 1 },
      },
    });

    // 5. Update the daily hospital metric
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.hospitalMetric.upsert({
      where: { id: today.toISOString() }, // Use date as a stable ID
      update: {
        consultationCount: { increment: 1 },
        revenueProtected: { increment: 1500 }, // Average revenue per visit
      },
      create: {
        id: today.toISOString(),
        date: today,
        consultationCount: 1,
        revenueProtected: 1500,
      },
    });

    // Write to Immutable Audit Trail
    await logAudit(
      visit.doctorId, 
      visit.doctor.name,
      'DOCTOR',
      'COMPLETED_CONSULTATION',
      visit.patientId,
      { waitTime: completedVisit.waitTime }
    );

    // Trigger pusher event
    await pusherServer.trigger('hospital-queue', 'queue-updated', {
      doctorId: visit.doctorId,
      completedVisitId: completedVisit.id,
      nextVisitId: nextVisit?.id || null
    }).catch(e => console.error("Pusher trigger failed:", e));

    return NextResponse.json({
      completedVisit,
      nextPatientId: nextVisit?.id || null,
      message: nextVisit
        ? `Next patient (${nextVisit.id}) is now consulting.`
        : 'Queue is now empty.',
    });

  } catch (error) {
    console.error('PATCH /api/visits/[id]/complete error:', error);
    return NextResponse.json({ error: 'Failed to complete visit' }, { status: 500 });
  }
}

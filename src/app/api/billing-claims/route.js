import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import Groq from 'groq-sdk';

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// POST: Generate an intelligent billing claim from a visit
export async function POST(request) {
  try {
    const { visitId, amount, tpaName, clinicalNoteOverride } = await request.json();

    if (!visitId || amount === undefined) {
      return NextResponse.json({ error: 'visitId and amount are required' }, { status: 400 });
    }

    // Ensure the Visit exists in the database to satisfy the foreign key constraint
    let visit = await prisma.visit.findUnique({ where: { id: visitId } });
    if (!visit) {
      // Find a doctor and a patient to link to the mock visit
      let doctor = await prisma.doctor.findFirst();
      if (!doctor) {
        doctor = await prisma.doctor.create({
          data: {
            id: 'doc_sarah_jenkins',
            name: 'Dr. Sarah Jenkins',
            specialization: 'Cardiology',
            department: 'Cardiology',
          }
        });
      }
      let patient = await prisma.patient.findFirst();
      if (!patient) {
        patient = await prisma.patient.create({
          data: {
            name: 'Michael Chen',
            dob: new Date('1980-01-01'),
            phone: '+1234567890',
            email: 'patient@medilink.com',
          }
        });
      }
      // Create the simulated visit
      visit = await prisma.visit.create({
        data: {
          id: visitId,
          patientId: patient.id,
          doctorId: doctor.id,
          status: 'COMPLETED',
          queuePosition: 0,
          reason: 'Simulated consultation'
        }
      });
      
      // Also create a ClinicalNote if clinicalNoteOverride is provided
      if (clinicalNoteOverride) {
        await prisma.clinicalNote.upsert({
          where: { visitId },
          update: {
            rawTranscript: "Simulated transcription.",
            subjective: clinicalNoteOverride.subjective || "",
            objective: clinicalNoteOverride.objective || "",
            assessment: clinicalNoteOverride.assessment || "",
            plan: clinicalNoteOverride.plan || "",
            status: "DRAFT",
          },
          create: {
            visitId,
            rawTranscript: "Simulated transcription.",
            subjective: clinicalNoteOverride.subjective || "",
            objective: clinicalNoteOverride.objective || "",
            assessment: clinicalNoteOverride.assessment || "",
            plan: clinicalNoteOverride.plan || "",
            status: "DRAFT",
          }
        });
      }
    }

    // 1. Fetch the clinical note associated with this visit, or use the override
    const clinicalNote = clinicalNoteOverride || await prisma.clinicalNote.findUnique({
      where: { visitId }
    });

    if (!clinicalNote) {
      return NextResponse.json({ error: 'ClinicalNote not found for this visit. Cannot generate intelligent claim.' }, { status: 404 });
    }

    let rejectionRisk = 0;
    let missingDocs = [];
    let status = 'PENDING';

    // 2. Use AI to analyze the claim risk if Groq is available
    if (groq) {
      const systemPrompt = `
      You are an AI Medical Billing Auditor. Your task is to analyze a Clinical SOAP Note and predict the probability of an insurance claim rejection.
      
      Look for:
      - Vague assessments or diagnoses without objective evidence.
      - Missing standard documents (e.g., if pneumonia is diagnosed, is an X-Ray mentioned?).
      - Misalignment between the plan and the assessment.
      
      Output MUST be exactly valid JSON matching this schema:
      {
        "rejectionRisk": number, // 0 to 100 percentage score
        "missingDocs": ["string", "string"] // Array of missing documents or justifications that an insurer would want
      }
      `;

      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Clinical Note:\nSubjective: ${clinicalNote.subjective}\nObjective: ${clinicalNote.objective}\nAssessment: ${clinicalNote.assessment}\nPlan: ${clinicalNote.plan}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      });

      const rawContent = completion.choices[0]?.message?.content?.trim();
      const aiData = JSON.parse(rawContent);

      rejectionRisk = aiData.rejectionRisk || 0;
      missingDocs = aiData.missingDocs || [];
      
      // Auto-flag claims with high rejection risk (> 30%)
      if (rejectionRisk > 30 || missingDocs.length > 0) {
        status = 'FLAGGED';
      }
    } else {
      console.warn("GROQ_API_KEY not configured. Skipping claim intelligence.");
    }

    // 3. Upsert the Billing Claim
    const billingClaim = await prisma.billingClaim.upsert({
      where: { visitId },
      update: {
        amount,
        tpaName,
        rejectionRisk,
        missingDocs,
        status
      },
      create: {
        visitId,
        amount,
        tpaName,
        rejectionRisk,
        missingDocs,
        status
      }
    });

    return NextResponse.json({ success: true, billingClaim });
  } catch (error) {
    console.error('POST /api/billing-claims error:', error);
    return NextResponse.json({ error: 'Failed to process billing claim', details: error.message }, { status: 500 });
  }
}

// GET: Fetch all billing claims (e.g., for Admin dashboard)
export async function GET(request) {
  try {
    const claims = await prisma.billingClaim.findMany({
      include: {
        visit: {
          include: { patient: true, doctor: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(claims);
  } catch (error) {
    console.error('GET /api/billing-claims error:', error);
    return NextResponse.json({ error: 'Failed to fetch billing claims' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import Groq from 'groq-sdk';
import { auth } from '@/auth';
import { verifyPatientAccess } from '@/lib/consentGuard';

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// POST: Ingest raw lab data, translate via AI, and save.
export async function POST(request) {
  try {
    const { patientId, visitId, testName, rawData } = await request.json();

    if (!patientId || !testName || !rawData) {
      return NextResponse.json({ error: 'patientId, testName, and rawData are required' }, { status: 400 });
    }

    // Validate patient exists — reject if not found (no ghost-patient creation)
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return NextResponse.json(
        { error: 'Patient not found. Lab reports must be linked to an existing patient.' },
        { status: 404 }
      );
    }
    const resolvedPatientId = patientId;

    let plainEnglish = null;
    let severity = 'NORMAL';
    let recommendation = null;

    if (groq) {
      const systemPrompt = `
      You are an AI Clinical Pathologist. Translate the following raw lab data into plain English for a patient.
      Do not use overly complex medical jargon.
      
      Task:
      1. Provide a short, easy-to-understand explanation of what the results mean (plainEnglish).
      2. Determine the severity. You MUST pick exactly one of: "NORMAL", "LOW", "HIGH", "CRITICAL".
      3. Provide a brief recommendation (e.g., "Discuss with your doctor", "Drink more water").
      
      Output MUST be exactly valid JSON matching this schema:
      {
        "plainEnglish": "string",
        "severity": "NORMAL" | "LOW" | "HIGH" | "CRITICAL",
        "recommendation": "string"
      }
      `;

      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Test Name: ${testName}\nRaw Data: ${JSON.stringify(rawData)}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      });

      const rawContent = completion.choices[0]?.message?.content?.trim();
      const aiData = JSON.parse(rawContent);

      plainEnglish = aiData.plainEnglish;
      severity = aiData.severity || 'NORMAL';
      recommendation = aiData.recommendation;
    } else {
      console.warn("GROQ_API_KEY not configured. Skipping AI translation.");
    }

    const labReport = await prisma.labReport.create({
      data: {
        patientId: resolvedPatientId,
        visitId,
        testName,
        rawData,
        plainEnglish,
        severity,
        recommendation
      }
    });

    return NextResponse.json({ success: true, labReport });
  } catch (error) {
    console.error('POST /api/lab-reports error:', error);
    return NextResponse.json({ error: 'Failed to process lab report. Please try again.' }, { status: 500 });
  }
}

// GET: Fetch lab reports for a patient
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    const emergencyBypass = searchParams.get('emergencyBypass') === 'true';

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    // HIPAA Consent Gatekeeper Check
    const session = await auth();
    const access = await verifyPatientAccess(session?.user, patientId, 'CLINICAL', emergencyBypass);
    if (!access.authorized) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const reports = await prisma.labReport.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(reports);
  } catch (error) {
    console.error('GET /api/lab-reports error:', error);
    return NextResponse.json({ error: 'Failed to fetch lab reports' }, { status: 500 });
  }
}

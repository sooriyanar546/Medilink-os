import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import prisma from '@/lib/prisma';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';

const groq = process.env.GROQ_API_KEY ? new Groq({
  apiKey: process.env.GROQ_API_KEY,
}) : null;

const SYSTEM_PROMPT = `
Context: You are an AI Medical Scribe integrated into an OPD (Outpatient Department) application. Your task is to act as a silent observer to a doctor-patient consultation transcript and generate a structured clinical record.

Input: A raw transcript of a conversation between a Doctor (D) and a Patient (P).

Task 1: Generate Clinical Summary (SOAP Format)
Extract and summarize the conversation into the following JSON-ready structure:
- subjective: Chief complaints, duration of symptoms, and relevant medical history.
- objective: Any physical observations, vitals, or test results discussed.
- assessment: The suspected or confirmed diagnosis mentioned by the physician.
- plan: Non-pharmacological advice (diet, rest, follow-up timing).

Task 2: Medication Recommendations
Provide a structured list of suggested medications based on the Assessment. For each medication, include:
- drugName (Generic preferred)
- dosage (e.g., 500mg)
- frequency (e.g., 1-0-1 or Post-Lunch)
- duration (e.g., 5 days)

Strict Guidelines:
1. Clinical Tone: Use formal medical terminology (e.g., "Cephalgia" instead of "headache" if appropriate).
2. Noise Filtering: Ignore small talk, greetings, or irrelevant interruptions.
3. Human-in-the-Loop: Append the following metadata to every response: {"status": "DRAFT", "requires_physician_signature": true}.
4. No Hallucinations: If a dosage wasn't mentioned and there isn't a standard one, leave it blank for the doctor to fill.

Output Format:
You MUST return ONLY a valid JSON object matching this exact structure:
{
  "subjective": "...",
  "objective": "...",
  "assessment": "...",
  "plan": "...",
  "medications": [
    { "drugName": "...", "dosage": "...", "frequency": "...", "duration": "..." }
  ],
  "status": "DRAFT",
  "requires_physician_signature": true
}
Do not include any markdown formatting, code blocks, or extra text. Just the raw JSON object.
`;

export async function POST(request) {
  try {
    // Rate limit: max 15 AI scribe calls per IP per minute to prevent Groq API abuse
    const rl = checkRateLimit(request, { limit: 15, windowMs: 60_000, prefix: 'ai-scribe' });
    if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

    const { transcript, visitId, vitals } = await request.json();

    if (!transcript || !visitId) {
      return NextResponse.json({ error: 'Transcript and visitId are required' }, { status: 400 });
    }

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant', // Fast inference for immediate doctor feedback
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Vitals Captured by Nurse:\n${vitals ? JSON.stringify(vitals) : 'None'}\n\nTranscript:\n\n"${transcript}"`,
        },
      ],
      temperature: 0.1, 
      max_tokens: 1024,
      response_format: { type: 'json_object' }, 
    });

    const rawContent = completion.choices[0]?.message?.content?.trim();
    const clinicalData = JSON.parse(rawContent);

    // Save to Database via Prisma
    const savedNote = await prisma.clinicalNote.upsert({
      where: { visitId },
      update: {
        rawTranscript: transcript,
        subjective: clinicalData.subjective,
        objective: clinicalData.objective,
        assessment: clinicalData.assessment,
        plan: clinicalData.plan,
        medications: clinicalData.medications || [],
        status: clinicalData.status || 'DRAFT',
        requiresPhysicianSignature: clinicalData.requires_physician_signature !== false,
      },
      create: {
        visitId,
        rawTranscript: transcript,
        subjective: clinicalData.subjective,
        objective: clinicalData.objective,
        assessment: clinicalData.assessment,
        plan: clinicalData.plan,
        medications: clinicalData.medications || [],
        status: clinicalData.status || 'DRAFT',
        requiresPhysicianSignature: clinicalData.requires_physician_signature !== false,
      },
    });

    return NextResponse.json({ success: true, note: savedNote });

  } catch (error) {
    console.error('AI Scribe Error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'AI returned malformed data. Please retry.' }, { status: 502 });
    }
    if (error?.status === 401) {
      return NextResponse.json({ error: 'AI scribe temporarily unavailable. Please retry or contact support.' }, { status: 503 });
    }

    // Never expose raw error internals to the client in production
    return NextResponse.json({ error: 'Failed to process transcript. Please retry.' }, { status: 500 });
  }
}


import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

// Groq is FREE — sign up at console.groq.com, no credit card needed.
const groq = process.env.GROQ_API_KEY ? new Groq({
  apiKey: process.env.GROQ_API_KEY,
}) : null;

const SYSTEM_PROMPT = `You are a compassionate patient communication specialist embedded in MediLink, a hospital operations platform. Your role is to translate complex medical lab results into simple, warm, and reassuring plain English for patients who are not medical professionals.

You will receive raw lab data and return ONLY valid JSON with no markdown, no code fences, and no extra text:
{
  "title": "Human-readable name of the test (e.g., 'Complete Blood Count')",
  "plainEnglish": "2-3 sentences explaining what the result means in simple language. Be warm, reassuring, and accurate. Avoid medical jargon entirely.",
  "severity": "normal | low | high | critical",
  "recommendation": "One clear, actionable next step for the patient written in plain language."
}

Rules:
- NEVER diagnose a condition. You are explaining, not diagnosing.
- Always be warm and human. Patients may be anxious.
- Use severity exactly as one of: normal, low, high, critical.
- Do NOT add disclaimers — the UI handles those automatically.
- Return ONLY the JSON object. No explanation. No preamble.`;

export async function POST(request) {
  try {
    const { labData } = await request.json();

    if (!labData) {
      return NextResponse.json({ error: 'Lab data is required' }, { status: 400 });
    }

    const completion = await groq.chat.completions.create({
      // llama-3.3-70b-versatile: Better reasoning for nuanced patient-friendly explanations
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Translate these lab results into plain English for a patient:\n\n${JSON.stringify(labData, null, 2)}`,
        },
      ],
      temperature: 0.4, // Slightly higher for more natural, warm language
      max_tokens: 512,
      response_format: { type: 'json_object' }, // Native JSON mode for reliable parsing
    });

    const rawContent = completion.choices[0]?.message?.content?.trim();
    const aiTranslation = JSON.parse(rawContent);

    return NextResponse.json(aiTranslation);

  } catch (error) {
    console.error('AI Report Error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'AI returned malformed data. Please retry.' }, { status: 502 });
    }
    if (error?.status === 401) {
      return NextResponse.json({ error: 'GROQ_API_KEY not configured. Get a free key at console.groq.com' }, { status: 503 });
    }

    return NextResponse.json({ error: 'Failed to translate report' }, { status: 500 });
  }
}

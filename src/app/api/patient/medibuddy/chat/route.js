/**
 * app/api/patient/medibuddy/chat/route.js
 *
 * MediBuddy AI — Conversational Patient Operations & Care Assistant
 *
 * Capabilities:
 *   1. Red-Flag Emergency Screening: Immediate deterministic interception for acute life-threats.
 *   2. Prescription & Medication Sig Guidance: Uses SigTranslatorService for dosing schedules.
 *   3. Outpatient Journey Wayfinding: Explains current stage, queue status, and next steps.
 *   4. Diagnostic Prep Guidance: Clear instructions on fasting, imaging preparation, etc.
 *   5. Groq LLaMA-3 with 8s timeout and rich deterministic offline fallback.
 *   6. Strict clinical boundary: Never issues definitive medical diagnoses.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import Groq from 'groq-sdk';
import { evaluateRedFlags } from '@/lib/middleware/redFlagTriageMiddleware';
import { translateSig, formatScheduleBadge } from '@/lib/services/SigTranslatorService';
import { getJourneyStatus } from '@/lib/services/QueueTrackingService';
import { logAudit } from '@/lib/audit';

// ─── Groq Client Initialisation ───────────────────────────────────────────────

let groq = null;
try {
  if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
} catch {
  // Offline fallback will be used
}

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 8000;

// ─── POST /api/patient/medibuddy/chat ──────────────────────────────────────────

export async function POST(request) {
  try {
    const session = await auth();
    const body = await request.json();
    const { message, conversationHistory = [] } = body;
    const patientId = session?.user?.patientId || session?.user?.id || body.patientId || 'pt_patient';
    const patientName = session?.user?.name || 'Patient';

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty.' }, { status: 400 });
    }

    const trimmedMessage = message.trim();

    // ── STEP 1: Deterministic Red-Flag Triage Check ────────────────────────────
    const triage = evaluateRedFlags(trimmedMessage, body.vitals || null);

    if (triage.severity === 'CRITICAL_EMERGENCY') {
      // Immediate life-threat: Short-circuit AI and deliver emergency triage protocol
      return NextResponse.json({
        reply: `🚨 **IMMEDIATE MEDICAL ATTENTION REQUIRED**\n\n${triage.guidance}\n\n**Emergency Contacts:**\n- 📞 **112 / 108** (Emergency / Ambulance in India)\n- 📞 **911** (Emergency in US/Canada)\n\nPlease do not wait or rely on this messaging tool. Proceed to the nearest Emergency Department immediately.`,
        isEmergency: true,
        triageSeverity: triage.severity,
        triggers: triage.matchedTriggers.map((t) => t.category),
        quickReplies: ['Call 112 Now', 'Emergency Floor Directions', 'I have contacted someone'],
        disclaimer: triage.disclaimer,
      });
    }

    // ── STEP 2: Grounding Context (Patient Medications, Queue, Recent Visit) ────
    let patientContext = {
      name: patientName,
      activeMedications: [],
      currentStage: null,
      queueWaitMins: null,
    };

    try {
      // Fetch active medications from recent clinical notes
      const recentNote = await prisma.clinicalNote?.findFirst?.({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      });

      if (recentNote?.medications && Array.isArray(recentNote.medications)) {
        patientContext.activeMedications = recentNote.medications.map((m) => {
          const { parsed, schedule } = translateSig(m.sig || m.frequency || '', m.drugName || '', m.dosage || '');
          return {
            drug: m.drugName || 'Medication',
            dosage: m.dosage || '',
            schedule: schedule.summary || m.frequency || 'Take as directed',
            badge: formatScheduleBadge(schedule),
          };
        });
      }

      // Fetch journey status
      const journey = await getJourneyStatus(patientId);
      if (journey) {
        patientContext.currentStage = journey.current_stage;
        patientContext.queueWaitMins = journey.ticket?.estimated_wait_mins;
      }
    } catch {
      // Best-effort context gathering; do not block chat on DB read failure
    }

    // ── STEP 3: Check for Medication / Sig Inquiry ─────────────────────────────
    // If the patient is asking specifically how to take a drug they are prescribed
    const isMedQuestion = /\b(?:take|taking|dose|dosage|schedule|how\s+often|before\s+or\s+after\s+food|bid|tid|qd|prn)\b/i.test(trimmedMessage);

    // ── STEP 4: Generate Response via Groq LLaMA-3 (with Timeout) ──────────────
    let aiReply = null;

    if (groq) {
      try {
        const systemPrompt = `
You are MediBuddy, an empathetic, highly professional Healthcare Operations and Patient Support Assistant at MediLink Hospital.
Your role:
1. Provide calm, reassuring operational guidance, hospital wayfinding, preparation advice (fasting, lab tests, imaging), and daily medication schedule reminders.
2. YOU ARE NOT A DIAGNOSING PHYSICIAN. Never diagnose conditions or prescribe medications. Always recommend discussing medical decisions with the treating doctor.
3. Keep your answers concise, well-formatted with markdown bullet points, clear, and easy to read on mobile.
4. If the patient asks about medications, reference their active prescriptions:
${JSON.stringify(patientContext.activeMedications, null, 2)}
5. Current Patient Operational Context:
- Current Location/Stage: ${patientContext.currentStage || 'General Outpatient Care'}
- Estimated Queue Wait: ${patientContext.queueWaitMins ? `${patientContext.queueWaitMins} minutes` : 'In consultation / Normal flow'}
`;

        const messages = [
          { role: 'system', content: systemPrompt },
          ...conversationHistory.slice(-4).map((h) => ({
            role: h.role === 'user' ? 'user' : 'assistant',
            content: h.text || h.content || '',
          })),
          { role: 'user', content: trimmedMessage },
        ];

        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), GROQ_TIMEOUT_MS);

        const completion = await groq.chat.completions.create(
          {
            model: GROQ_MODEL,
            messages,
            temperature: 0.2,
            max_tokens: 600,
          },
          { signal: abortController.signal }
        );

        clearTimeout(timeoutId);
        aiReply = completion.choices?.[0]?.message?.content?.trim();
      } catch (groqErr) {
        console.warn('[MediBuddy] Groq call failed or timed out. Falling back to deterministic assistant:', groqErr?.message);
      }
    }

    // ── STEP 5: Deterministic Fallback Assistant (Fail-Forward) ─────────────────
    if (!aiReply) {
      aiReply = generateDeterministicReply(trimmedMessage, patientContext);
    }

    // Log chat interaction for HIPAA audit (without logging full sensitive PHI)
    logAudit(
      session?.user?.id || 'anonymous',
      patientName,
      'PATIENT',
      'MEDIBUDDY_INTERACTION',
      patientId,
      {
        hasActiveMeds: patientContext.activeMedications.length > 0,
        stage: patientContext.currentStage,
        timestamp: new Date().toISOString(),
      }
    ).catch(() => {});

    return NextResponse.json({
      reply: aiReply,
      isEmergency: false,
      triageSeverity: triage.severity,
      quickReplies: generateQuickReplies(trimmedMessage, patientContext),
      disclaimer: 'MediBuddy provides operational support and schedule reminders. For medical advice, consult your doctor.',
    });
  } catch (error) {
    console.error('POST /api/patient/medibuddy/chat error:', error);
    return NextResponse.json(
      {
        reply: 'I am currently operating in basic mode. If you need assistance, please consult the front desk or contact your nurse station.',
        isEmergency: false,
        error: 'Assistant temporarily in offline fallback',
      },
      { status: 200 }
    );
  }
}

/**
 * Deterministic rule-based conversational generator when Groq is unavailable.
 */
function generateDeterministicReply(message, context) {
  const lower = message.toLowerCase();

  // Medication scheduling questions
  if (lower.includes('medication') || lower.includes('medicine') || lower.includes('dose') || lower.includes('how to take')) {
    if (context.activeMedications.length > 0) {
      const medList = context.activeMedications
        .map((m) => `• **${m.drug}** (${m.dosage}): ${m.schedule}`)
        .join('\n');
      return `Here are your currently prescribed medication schedules on file:\n\n${medList}\n\n*Always take prescription medications as instructed on the pharmacy label. If you experience unexpected side effects, contact your doctor.*`;
    }
    return `To review your medication schedules, please open the **Prescriptions** tab on your patient dashboard or confirm with your pharmacist.`;
  }

  // Queue / waiting questions
  if (lower.includes('wait') || lower.includes('queue') || lower.includes('when') || lower.includes('turn') || lower.includes('doctor ready')) {
    if (context.currentStage) {
      return `You are currently in the **${context.currentStage}** stage of your hospital visit. ${
        context.queueWaitMins ? `Estimated remaining wait time: approximately **${context.queueWaitMins} minutes**.` : 'Your doctor will call your ticket number shortly.'
      } You will hear an announcement and chime when it is your turn.`;
    }
    return `Your queue position is updated in real time on your dashboard. Please stay in the designated waiting lounge.`;
  }

  // Diet / nutrition questions
  if (lower.includes('diet') || lower.includes('eat') || lower.includes('food') || lower.includes('nutrition')) {
    return `For personalized meal and nutrition guidelines matching your condition (such as DASH for blood pressure or Low-GI for blood sugar), visit the **Clinical Nutrition & Dietitian** section on your portal or request an in-person dietitian consultation.`;
  }

  // Lab report questions
  if (lower.includes('lab') || lower.includes('blood test') || lower.includes('report') || lower.includes('result')) {
    return `Your diagnostic reports are accessible under the **Diagnostic Reports** section. Our AI Pathology Explainer will provide an easy-to-understand breakdown of every biomarker with reference ranges.`;
  }

  // Default polite operational guidance
  return `Hello ${context.name}, I am here to help you navigate your care journey at MediLink. You can ask me about your current wait time, medication schedules, test preparations, or hospital facilities. How can I assist you today?`;
}

/**
 * Suggests contextual chips for rapid user interaction.
 */
function generateQuickReplies(message, context) {
  const lower = message.toLowerCase();
  if (lower.includes('medication') || lower.includes('dose')) {
    return ['What if I miss a dose?', 'Dietary restrictions', 'Speak to Pharmacist'];
  }
  if (lower.includes('wait') || lower.includes('queue')) {
    return ['Refresh wait time', 'Where is Room 112?', 'Notify me when called'];
  }
  return ['Check my wait time', 'My medications', 'Nutrition recommendations', 'Find facilities'];
}

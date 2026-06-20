import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { pusherServer } from '@/lib/pusher';

export async function POST(req) {
  let webhookLogId = null;
  let rawBodyText = '';

  try {
    rawBodyText = await req.text();
    const params = new URLSearchParams(rawBodyText);
    
    // Convert urlencoded params to a key-value object
    const payload = {};
    for (const [key, val] of params.entries()) {
      payload[key] = val;
    }

    // 1. Log raw webhook payload in the database immediately for resilience & audit logs
    const webhookLog = await prisma.webhookLog.create({
      data: {
        provider: 'TWILIO',
        payload: payload,
        processed: false
      }
    });
    webhookLogId = webhookLog.id;

    const from = payload.From || '';
    const body = (payload.Body || '').trim();

    if (!from) {
      throw new Error('From parameter is missing in Twilio webhook payload');
    }

    // 2. Locate Patient by cleaning the phone number (match last 10 digits to be international robust)
    let targetPatientId = 'pt_michael_chen'; // fallback
    const cleanPhone = from.replace(/whatsapp:/i, '').trim();
    const cleanPhoneDigits = cleanPhone.replace(/\D/g, '');

    if (cleanPhoneDigits) {
      const patient = await prisma.patient.findFirst({
        where: {
          phone: {
            contains: cleanPhoneDigits.slice(-10)
          }
        }
      });
      if (patient) {
        targetPatientId = patient.id;
      }
    }

    // 3. Log patient compliance incoming text
    await prisma.message.create({
      data: {
        patientId: targetPatientId,
        content: body,
        channel: 'WHATSAPP',
        deliveryStatus: 'READ',
        sentAt: new Date()
      }
    });

    // 4. Hybrid Intent Classifier
    const lowerBody = body.toLowerCase();
    
    // Check TAKEN deterministic triggers
    const isTaken = lowerBody.includes('taken') || 
                    lowerBody.includes('took') || 
                    lowerBody.includes('done') || 
                    lowerBody.includes('yes') || 
                    lowerBody.includes('✅') || 
                    lowerBody.includes('taken ✅') ||
                    lowerBody.includes('morning');

    // Check SNOOZE deterministic triggers
    const isSnooze = lowerBody.includes('snooze') || 
                     lowerBody.includes('wait') || 
                     lowerBody.includes('later') || 
                     lowerBody.includes('30m') || 
                     lowerBody.includes('30 min') || 
                     lowerBody.includes('1h') || 
                     lowerBody.includes('60m') ||
                     lowerBody.includes('⏰');

    if (isTaken) {
      // Compliance TAKEN action
      await prisma.message.create({
        data: {
          patientId: targetPatientId,
          content: '✅ Thank you, Michael! Your check-in has been logged in our secure HIPAA compliance ledger. Keep up your healthy adherence!',
          channel: 'WHATSAPP',
          deliveryStatus: 'SENT'
        }
      });

      // Write HIPAA Audit Log
      await logAudit(
        'system_twilio',
        'Twilio Webhook Gateway',
        'PATIENT',
        'COMPLIANCE_WHATSAPP_TAKEN',
        targetPatientId,
        { body, rawFrom: from }
      );

      // Trigger Pusher client update to toggle checklist checkbox dynamically
      await pusherServer.trigger(`patient-${targetPatientId}`, 'compliance-checked', {
        timeOfDay: 'morning',
        checked: true
      });

    } else if (isSnooze) {
      // Compliance SNOOZE action
      const delayMinutes = lowerBody.includes('60') || lowerBody.includes('1h') ? 60 : 30;
      const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      await prisma.snoozedReminder.create({
        data: {
          patientId: targetPatientId,
          medicationName: 'Amlodipine 5mg',
          scheduledAt,
          status: 'PENDING',
          channel: 'WHATSAPP'
        }
      });

      await prisma.message.create({
        data: {
          patientId: targetPatientId,
          content: `⏰ Snoozed. We will ping you again in ${delayMinutes} minutes! Make sure to take your Amlodipine 5mg shortly.`,
          channel: 'WHATSAPP',
          deliveryStatus: 'SENT'
        }
      });

      // Write HIPAA Audit Log
      await logAudit(
        'system_twilio',
        'Twilio Webhook Gateway',
        'PATIENT',
        'COMPLIANCE_WHATSAPP_SNOOZED',
        targetPatientId,
        { durationMinutes: delayMinutes, scheduledAt }
      );

      // Trigger Pusher updates
      await pusherServer.trigger(`patient-${targetPatientId}`, 'compliance-snoozed', {
        delayMinutes,
        scheduledAt
      });

    } else {
      // Fallback: Conversational Guided Care (MediBuddy)
      let reply = '';
      if (lowerBody.includes('diet') || lowerBody.includes('nutrition') || lowerBody.includes('food') || lowerBody.includes('eat')) {
        reply = '🍏 MediBuddy: Based on your active Hypertension profile, we recommend the DASH diet plan: limit sodium (<1,500mg/day), focus on potassium-rich foods (bananas, sweet potatoes), poultry, and dietary fiber. Click "Book Dietitian" to speak with local cardiovascular specialists!';
      } else if (lowerBody.includes('dizzy') || lowerBody.includes('side effect') || lowerBody.includes('sleepy')) {
        reply = '⚠️ MediBuddy: Occasional dizziness or mild fatigue can occur starting Amlodipine as your blood vessels relax. Please rest, hydrate with plain water, and avoid fast standing transitions. Contact nursing staff if symptoms persist.';
      } else {
        reply = '🤖 MediBuddy Care Guide: I hear you, Michael. To help you feel completely supported, remember to take your medications on time, rest, and check out the local dietitian Referral deck for customized medical meal layouts!';
      }

      await prisma.message.create({
        data: {
          patientId: targetPatientId,
          content: reply,
          channel: 'WHATSAPP',
          deliveryStatus: 'SENT'
        }
      });
    }

    // Trigger Pusher global update to refresh messages list on screen instantly
    await pusherServer.trigger(`patient-${targetPatientId}`, 'message-received', {
      from,
      body
    });

    // 5. Mark webhook log as successfully processed
    await prisma.webhookLog.update({
      where: { id: webhookLogId },
      data: { processed: true }
    });

    // Return clean twilio compliant response XML or JSON
    return new NextResponse(
      `<Response></Response>`,
      {
        status: 200,
        headers: { 'Content-Type': 'application/xml' }
      }
    );

  } catch (error) {
    console.error('Webhook Error:', error);
    
    // Log failure details in raw WebhookLog table if ID was created
    if (webhookLogId) {
      await prisma.webhookLog.update({
        where: { id: webhookLogId },
        data: {
          processed: false,
          error: error.message || error.toString()
        }
      });
    }

    return NextResponse.json({ success: false, error: 'Webhook processing failed.' }, { status: 500 });
  }
}

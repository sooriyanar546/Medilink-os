import prisma from './prisma';
import { pusherServer } from './pusher';
import { logAudit } from './audit';

// Prevent multiple scheduler intervals from starting in Next.js development hot-reloads
const globalForScheduler = globalThis;

export async function startScheduler() {
  if (globalForScheduler.schedulerActive) {
    console.log('⏰ Background Task Scheduler is already running.');
    return;
  }

  globalForScheduler.schedulerActive = true;
  console.log('⏰ Initializing Background Task Scheduler (Adherence Snooze Polling)...');

  // Poll every 15 seconds for responsive clinical alerts
  const intervalId = setInterval(async () => {
    try {
      const now = new Date();
      
      // Query pending reminders whose scheduledAt time has expired
      const expiredReminders = await prisma.snoozedReminder.findMany({
        where: {
          status: 'PENDING',
          scheduledAt: {
            lte: now
          }
        },
        include: {
          patient: true
        }
      });

      if (expiredReminders.length === 0) {
        return;
      }

      console.log(`⏰ Found ${expiredReminders.length} expired snoozed reminder(s). Dispatching alarms...`);

      for (const reminder of expiredReminders) {
        const patientName = reminder.patient?.name || 'Michael';
        const medication = reminder.medicationName || 'Amlodipine 5mg';
        
        const alarmMessage = `🔔 Adherence Alert: Hi ${patientName}, your 30-minute snooze has expired. Please take your ${medication} now to maintain cardiorespiratory wellness. Reply TAKEN to log your adherence or SNOOZE to delay by another 30 minutes.`;

        // 1. Log the system message in the database so the patient sees it in their chat history
        await prisma.message.create({
          data: {
            patientId: reminder.patientId,
            content: alarmMessage,
            channel: 'WHATSAPP',
            deliveryStatus: 'SENT',
            sentAt: new Date()
          }
        });

        // 2. Write an immutable HIPAA Audit Log
        await logAudit(
          'system_scheduler',
          'Background Task Scheduler',
          'SYSTEM',
          'COMPLIANCE_WHATSAPP_REMINDED',
          reminder.patientId,
          { medicationName: medication, reminderId: reminder.id }
        );

        // 3. Mark the reminder as COMPLETED in the database
        await prisma.snoozedReminder.update({
          where: { id: reminder.id },
          data: { status: 'COMPLETED' }
        });

        // 4. Trigger Pusher updates: message-received (to update chat list) and compliance-reminded (to trigger tone/banner)
        const channelName = `patient-${reminder.patientId}`;
        
        await pusherServer.trigger(channelName, 'message-received', {
          from: 'system',
          body: alarmMessage
        });

        await pusherServer.trigger(channelName, 'compliance-reminded', {
          medicationName: medication,
          message: alarmMessage
        });

        console.log(`✅ Adherence alarm successfully fired for Patient [${reminder.patientId}] medication [${medication}].`);
      }
    } catch (error) {
      console.error('❌ Error inside Background Task Scheduler tick:', error);
    }
  }, 15000);

  // Store interval in global context so we can clean it if needed during hot reloads (optional)
  globalForScheduler.schedulerIntervalId = intervalId;
}

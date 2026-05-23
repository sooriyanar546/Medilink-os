import prisma from '@/lib/prisma';

export async function logAudit(userId, userName, role, action, patientId = null, details = null) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        userName,
        role,
        action,
        patientId,
        details: details || {}
      }
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

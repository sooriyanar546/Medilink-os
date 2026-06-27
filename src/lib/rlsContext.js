/**
 * lib/rlsContext.js
 *
 * Injects PostgreSQL session variables needed by Row Level Security policies.
 * Must be called inside a Prisma transaction so SET LOCAL is scoped
 * to that transaction only — values are automatically cleared when the
 * transaction commits or rolls back.
 *
 * Variables set (read by SQL functions in 001_rls_policies.sql):
 *   app.current_role        — e.g. 'PATIENT', 'DOCTOR', 'ADMIN'
 *   app.current_user_id     — NextAuth User.id (cuid)
 *   app.current_patient_id  — Patient.id (cuid), or '' for non-patients
 *   app.current_doctor_id   — Doctor.id (cuid), or '' for non-doctors
 *
 * Usage:
 *   import { withRLSContext } from '@/lib/rlsContext';
 *   const data = await withRLSContext(session, (tx) =>
 *     tx.vitalLog.findMany({ where: { patientId } })
 *   );
 */

import prisma from '@/lib/prisma';

/**
 * Runs a Prisma callback inside a transaction with RLS session vars injected.
 *
 * @param {object} session         - NextAuth session object
 * @param {Function} prismaCallback - (tx: PrismaTransaction) => Promise<any>
 * @returns {Promise<any>}
 */
export async function withRLSContext(session, prismaCallback) {
  const role      = (session?.user?.role || '').toUpperCase();
  const userId    = session?.user?.id    || '';
  const patientId = session?.user?.patientId || '';
  const doctorId  = session?.user?.doctorId  || '';

  return prisma.$transaction(async (tx) => {
    // SET LOCAL ensures these values are ONLY visible within this transaction
    // and are never leaked to concurrent requests sharing the same connection.
    await tx.$executeRaw`SELECT set_config('app.current_role',       ${role},      true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id',    ${userId},    true)`;
    await tx.$executeRaw`SELECT set_config('app.current_patient_id', ${patientId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_doctor_id',  ${doctorId},  true)`;

    return prismaCallback(tx);
  });
}

/**
 * Lightweight version for read-only operations that don't need a full
 * transaction but still need RLS context (uses $executeRawUnsafe carefully).
 * Prefer withRLSContext for mutations.
 *
 * @param {object} session
 * @param {Function} prismaCallback - (prisma: PrismaClient) => Promise<any>
 */
export async function withRLSContextRead(session, prismaCallback) {
  const role      = (session?.user?.role || '').toUpperCase();
  const userId    = session?.user?.id    || '';
  const patientId = session?.user?.patientId || '';
  const doctorId  = session?.user?.doctorId  || '';

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_role',       ${role},      true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id',    ${userId},    true)`;
    await tx.$executeRaw`SELECT set_config('app.current_patient_id', ${patientId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_doctor_id',  ${doctorId},  true)`;
    return prismaCallback(tx);
  }, { timeout: 10000 });
}

import prisma from '@/lib/prisma';
import { verifyConsentToken } from './consent';
import { logAudit } from './audit';

/**
 * Validates whether the logged-in user has permission to access a patient's data.
 * Supports Patient self-access, Admin bypass, Doctor/Pharmacist active consent check, 
 * and emergency Break Glass override.
 * 
 * @param {Object} sessionUser - The NextAuth session user (req.auth?.user)
 * @param {string} patientId - The ID of the patient record being accessed
 * @param {string} requiredLevel - The ConsentAccessLevel required ('CLINICAL', 'MEDICATION', 'BILLING')
 * @param {boolean} emergencyBypass - True if requesting an emergency override
 * @returns {Promise<Object>} Verification result: { authorized: boolean, error: string, status: number }
 */
export async function verifyPatientAccess(sessionUser, patientId, requiredLevel, emergencyBypass = false) {
  if (!sessionUser) {
    return { 
      authorized: false, 
      error: 'Authentication required. Active session not found.', 
      status: 401 
    };
  }

  const role = sessionUser.role?.toUpperCase();
  const userId = sessionUser.id;
  const userPatientId = sessionUser.patientId;
  const userDoctorId = sessionUser.doctorId;

  // 1. Admin Bypass
  if (role === 'ADMIN') {
    return { authorized: true, type: 'ADMIN_OVERRIDE' };
  }

  // 2. Patient Self Access
  if (role === 'PATIENT' && userPatientId === patientId) {
    return { authorized: true, type: 'PATIENT_SELF' };
  }

  // 3. Emergency Break Glass Override
  if (emergencyBypass) {
    if (role === 'DOCTOR' || role === 'ADMIN') {
      // Fetch doctor details for detailed logging
      let doctorName = sessionUser.name || 'Emergency Doctor';
      if (userDoctorId) {
        const doctor = await prisma.doctor.findUnique({ where: { id: userDoctorId } });
        if (doctor) doctorName = doctor.name;
      }

      // Log a critical, high-priority audit entry for compliance
      await logAudit(
        userDoctorId || userId,
        doctorName,
        role,
        'EMERGENCY_CONSENT_BYPASS',
        patientId,
        { 
          message: `Doctor activated Break Glass override to bypass patient consent.`,
          requiredLevel,
          accessorId: userDoctorId || userId 
        }
      ).catch(e => console.error('Failed to log emergency audit:', e));

      return { authorized: true, type: 'EMERGENCY_BYPASS' };
    } else {
      return { 
        authorized: false, 
        error: 'Forbidden: Only Doctors or Administrators can activate Break Glass overrides.', 
        status: 403 
      };
    }
  }

  // 4. Consent Token Check (Access database and check signature)
  const accessorId = userDoctorId || userId;

  const consents = await prisma.patientConsent.findMany({
    where: {
      patientId: patientId,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      OR: [
        { accessorId: accessorId },
        { accessorId: '*' } // Wildcard consent (e.g. clinic-wide consent)
      ]
    }
  });

  // Check if any matching consent record has a valid signature and sufficient clearance
  for (const consent of consents) {
    const isValidSignature = verifyConsentToken(consent);
    if (isValidSignature) {
      const level = consent.accessLevel;
      
      // Hierarchy: CLINICAL has access to everything. 
      // MEDICATION allows MEDICATION records.
      // BILLING allows BILLING records.
      const isLevelAllowed = 
        level === 'CLINICAL' || 
        (requiredLevel === 'MEDICATION' && level === 'MEDICATION') ||
        (requiredLevel === 'BILLING' && level === 'BILLING');

      if (isLevelAllowed) {
        return { 
          authorized: true, 
          type: 'CONSENT_GRANTED', 
          consentId: consent.id 
        };
      }
    }
  }

  // If no valid consent was found, block access
  return { 
    authorized: false, 
    error: `Access Denied: Missing or expired patient consent for ${requiredLevel} records.`, 
    status: 403 
  };
}

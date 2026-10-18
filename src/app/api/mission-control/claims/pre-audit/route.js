/**
 * app/api/mission-control/claims/pre-audit/route.js
 *
 * POST /api/mission-control/claims/pre-audit
 *
 * Runs a full AI + rules-based pre-submission audit on a billing claim.
 * Fetches the linked ClinicalNote from the database, sanitises it, runs
 * ClaimsAuditService, then:
 *   - Updates the BillingClaim record with the rejection risk score
 *   - Sets the claim status to 'FLAGGED' or 'PENDING' based on results
 *   - Writes an immutable audit log entry
 *
 * Request Body:
 *   {
 *     claimId:  string   - BillingClaim.id to audit
 *     visitId?: string   - Alternative: look up claim by visitId
 *     forceAI?: boolean  - Force AI path even if claim is already audited
 *   }
 *
 * Access: ADMIN, CASHIER
 * Rate Limit: 10 requests per minute per IP (Groq API protection)
 */

import { NextResponse } from 'next/server';
import { withHipaaAudit } from '@/lib/middleware/hipaaAuditHook';
import { auditClaimWithAI } from '@/lib/services/ClaimsAuditService';
import prisma from '@/lib/prisma';
import { withRLSContext } from '@/lib/rlsContext';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';
import { pusherServer } from '@/lib/pusher';

// ── Input validation ──────────────────────────────────────────────────────────
function validatePreAuditInput(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return ['Request body must be a JSON object'];

  const { claimId, visitId } = body;
  if (!claimId && !visitId) {
    errors.push('Either claimId or visitId is required');
  }
  if (claimId && typeof claimId !== 'string') errors.push('claimId must be a string');
  if (visitId && typeof visitId !== 'string') errors.push('visitId must be a string');

  return errors;
}

export const POST = withHipaaAudit(
  'CLAIM_PRE_AUDIT',
  ['ADMIN', 'CASHIER'],
  async (request, session) => {

    // ── Rate limit: 10 AI audits per minute per IP ─────────────────────────
    const rl = checkRateLimit(request, { limit: 10, windowMs: 60_000, prefix: 'claim-audit' });
    if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

    try {
      const body = await request.json();
      const validationErrors = validatePreAuditInput(body);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          { error: 'Validation failed', details: validationErrors },
          { status: 422 }
        );
      }

      const { claimId, visitId, forceAI = false } = body;

      // ── Fetch claim + clinical note ────────────────────────────────────────
      const data = await withRLSContext(session, async (tx) => {
        const claim = claimId
          ? await tx.billingClaim.findUnique({
              where: { id: claimId },
              include: {
                visit: {
                  include: {
                    clinicalNote: true,
                    patient: { select: { id: true } },
                    doctor:  { select: { id: true, specialization: true } },
                  },
                },
              },
            })
          : await tx.billingClaim.findFirst({
              where: { visitId },
              include: {
                visit: {
                  include: {
                    clinicalNote: true,
                    patient: { select: { id: true } },
                    doctor:  { select: { id: true, specialization: true } },
                  },
                },
              },
            });

        return claim;
      });

      if (!data) {
        return NextResponse.json(
          { error: 'Billing claim not found' },
          { status: 404 }
        );
      }

      const clinicalNote = data.visit?.clinicalNote;
      if (!clinicalNote) {
        return NextResponse.json(
          { error: 'No clinical note found for this claim. A SOAP note must be completed before pre-audit.' },
          { status: 422 }
        );
      }

      // ── Skip re-audit if already audited and forceAI is false ─────────────
      if (!forceAI && data.status === 'FLAGGED' && data.rejectionRisk !== null) {
        return NextResponse.json({
          cached: true,
          claimId: data.id,
          rejectionRisk: data.rejectionRisk,
          status: data.status,
          missingDocs: data.missingDocs || [],
          message: 'This claim was previously audited. Use forceAI: true to re-run.',
        });
      }

      // ── Run AI + rules-based audit ─────────────────────────────────────────
      const medications = Array.isArray(clinicalNote.medications) ? clinicalNote.medications : [];

      const auditResult = await auditClaimWithAI({
        subjective:  clinicalNote.subjective || '',
        objective:   clinicalNote.objective  || '',
        assessment:  clinicalNote.assessment || '',
        plan:        clinicalNote.plan       || '',
        medications,
        icd10Code:   null, // Can be extended if ICD-10 is stored on ClinicalNote
        tpaName:     data.tpaName  || null,
        amount:      data.amount   || null,
      });

      // ── Persist audit results back to BillingClaim ─────────────────────────
      const updatedClaim = await withRLSContext(session, async (tx) => {
        return tx.billingClaim.update({
          where: { id: data.id },
          data: {
            rejectionRisk: auditResult.rejectionRisk,
            missingDocs:   [...auditResult.missingDocumentation, ...auditResult.discrepancies],
            status:        auditResult.claimStatus,
          },
        });
      });

      // ── Broadcast to Mission Control dashboard ─────────────────────────────
      try {
        await pusherServer.trigger('hospital-queue', 'queue-updated', {
          type:        'CLAIM_AUDITED',
          claimId:     data.id,
          riskLevel:   auditResult.riskLevel,
          shouldFlag:  auditResult.shouldFlag,
        });
      } catch (pusherError) {
        console.error('[ClaimsPreAudit] Pusher failed (non-critical):', pusherError.message);
      }

      return NextResponse.json({
        claimId:              updatedClaim.id,
        visitId:              data.visitId,
        rejectionRisk:        auditResult.rejectionRisk,
        riskLevel:            auditResult.riskLevel,
        missingDocumentation: auditResult.missingDocumentation,
        discrepancies:        auditResult.discrepancies,
        icd10AlignmentScore:  auditResult.icd10AlignmentScore,
        auditSummary:         auditResult.auditSummary,
        aiAssisted:           auditResult.aiAssisted,
        shouldFlag:           auditResult.shouldFlag,
        claimStatus:          updatedClaim.status,
        auditedAt:            new Date().toISOString(),
      });

    } catch (error) {
      console.error('POST /api/mission-control/claims/pre-audit error:', error);
      return NextResponse.json(
        { error: 'Failed to run claim pre-audit. Please try again.' },
        { status: 500 }
      );
    }
  }
);

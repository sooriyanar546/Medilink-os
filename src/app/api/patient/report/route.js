/**
 * app/api/patient/report/route.js
 *
 * GET  /api/patient/report - Retrieve patient lab reports with biomarker explanations
 * POST /api/patient/report - Generate AI pathology explanation for lab test results
 *
 * Implements:
 *   - Integration with LabExplainerService (biomarker classification + Groq LLaMA-3 + offline fallback)
 *   - Clinical safety guardrails (mandatory disclaimer, critical severity escalation)
 *   - ABDM / HIPAA consent verification for clinician access
 *   - Structured biomarker breakdown persistence in biomarker_results table
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { verifyConsentRequest } from '@/lib/middleware/verifyConsentToken';
import { explainLabReport, classifyBiomarker, CLINICAL_SAFETY_DISCLAIMER } from '@/lib/services/LabExplainerService';
import { logAudit } from '@/lib/audit';

// ─── GET: Fetch Lab Reports ───────────────────────────────────────────────────

export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedPatientId = searchParams.get('patientId') || session.user.patientId || session.user.id;
    const reportId = searchParams.get('id');

    // Consent check if clinician is accessing another patient's report
    const consent = await verifyConsentRequest(request, session, requestedPatientId, {
      requiredDataType: 'DiagnosticReport',
    });

    if (!consent.authorized) {
      return NextResponse.json({ error: consent.error }, { status: consent.status });
    }

    // 1. Fetch single report by ID if specified
    if (reportId) {
      const report = await prisma.labReport.findUnique({
        where: { id: reportId },
        include: {
          patient: { select: { id: true, name: true, dob: true, bloodGroup: true } },
          visit: { select: { id: true, tokenNumber: true, visitType: true, createdAt: true } },
        },
      });

      if (!report || report.patientId !== requestedPatientId) {
        return NextResponse.json({ error: 'Lab report not found or access unauthorized.' }, { status: 404 });
      }

      // Check for structured biomarker line items in biomarker_results
      let biomarkers = [];
      try {
        biomarkers = await prisma.$queryRawUnsafe(
          `SELECT id, name, abbreviation, panel, measured_value, unit, ref_low, ref_high, ref_text,
                  severity, delta_percent, plain_explanation, urgent_consultation_required
           FROM biomarker_results
           WHERE lab_report_id = $1
           ORDER BY created_at ASC`,
          reportId
        );
      } catch {
        // Table might be pending migration or empty
      }

      return NextResponse.json({
        report: {
          ...report,
          biomarkers,
          disclaimer: CLINICAL_SAFETY_DISCLAIMER,
        },
      });
    }

    // 2. Fetch all reports for this patient
    const reports = await prisma.labReport.findMany({
      where: { patientId: requestedPatientId },
      orderBy: { createdAt: 'desc' },
      include: {
        visit: { select: { id: true, tokenNumber: true, visitType: true } },
      },
    });

    return NextResponse.json({
      patientId: requestedPatientId,
      total: reports.length,
      reports,
      disclaimer: CLINICAL_SAFETY_DISCLAIMER,
    });
  } catch (error) {
    console.error('GET /api/patient/report error:', error);
    return NextResponse.json({ error: 'Failed to retrieve lab reports' }, { status: 500 });
  }
}

// ─── POST: Generate AI Pathology Explanation ──────────────────────────────────

export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { reportId, testName, rawData, biomarkers = [] } = body;
    const patientId = body.patientId || session.user.patientId || session.user.id;

    // Consent check
    const consent = await verifyConsentRequest(request, session, patientId, {
      requiredDataType: 'DiagnosticReport',
    });

    if (!consent.authorized) {
      return NextResponse.json({ error: consent.error }, { status: consent.status });
    }

    // Prepare biomarker list for LabExplainerService
    let normalizedBiomarkers = [];

    if (Array.isArray(biomarkers) && biomarkers.length > 0) {
      normalizedBiomarkers = biomarkers.map((b) => ({
        name: b.name || b.biomarker,
        value: parseFloat(b.value ?? b.measured_value ?? b.result),
        unit: b.unit || '',
        ref_low: b.ref_low !== undefined ? parseFloat(b.ref_low) : null,
        ref_high: b.ref_high !== undefined ? parseFloat(b.ref_high) : null,
      }));
    } else if (rawData && typeof rawData === 'object') {
      // Convert key-value rawData into biomarker items
      normalizedBiomarkers = Object.entries(rawData).map(([key, val]) => {
        const numVal = typeof val === 'object' ? parseFloat(val.value) : parseFloat(val);
        const unit = typeof val === 'object' ? val.unit || '' : '';
        return {
          name: key,
          value: isNaN(numVal) ? 0 : numVal,
          unit,
        };
      });
    } else if (reportId) {
      // Re-fetch report from DB to explain
      const existing = await prisma.labReport.findUnique({ where: { id: reportId } });
      if (existing?.rawData && typeof existing.rawData === 'object') {
        normalizedBiomarkers = Object.entries(existing.rawData).map(([key, val]) => ({
          name: key,
          value: parseFloat(val?.value ?? val) || 0,
          unit: val?.unit || '',
        }));
      }
    }

    if (normalizedBiomarkers.length === 0) {
      return NextResponse.json(
        { error: 'No biomarker values provided for explanation. Pass an array of biomarkers or rawData.' },
        { status: 422 }
      );
    }

    // Run AI Pathology Explanation Engine (with timeout & fallback)
    const explanationResult = await explainLabReport({
      testName: testName || 'Diagnostic Panel',
      biomarkers: normalizedBiomarkers,
    });

    // Optionally persist to biomarker_results table if reportId is provided
    if (reportId) {
      try {
        for (const item of explanationResult.biomarkers) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO biomarker_results
               (id, lab_report_id, patient_id, name, panel, measured_value, unit,
                ref_low, ref_high, severity, plain_explanation, urgent_consultation_required, created_at)
             VALUES
               (gen_random_uuid()::TEXT, $1, $2, $3, $4, $5, $6, $7, $8, $9::biomarker_severity, $10, $11, NOW())`,
            reportId,
            patientId,
            item.name,
            testName || 'General',
            item.value,
            item.unit || '',
            item.ref_low,
            item.ref_high,
            item.severity,
            item.plain_explanation || item.summary,
            item.severity === 'CRITICAL'
          );
        }

        // Also update LabReport summary
        await prisma.labReport.update({
          where: { id: reportId },
          data: {
            plainEnglish: explanationResult.summary,
            severity: explanationResult.overallSeverity,
            recommendation: explanationResult.actionableTips?.join(' ') || null,
          },
        });
      } catch (dbErr) {
        // Table might not exist in dev or non-fatal persistence error
        console.warn('[patient/report] Biomarker persistence non-fatal error:', dbErr?.message);
      }
    }

    // Write audit record
    logAudit(
      session.user.id,
      session.user.name || 'User',
      session.user.role || 'PATIENT',
      'AI_LAB_EXPLAIN_GENERATED',
      patientId,
      {
        testName: testName || 'Diagnostic Panel',
        biomarkerCount: normalizedBiomarkers.length,
        overallSeverity: explanationResult.overallSeverity,
      }
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      reportId: reportId || null,
      explanation: explanationResult,
    });
  } catch (error) {
    console.error('POST /api/patient/report error:', error);
    return NextResponse.json({ error: 'Failed to process lab report explanation' }, { status: 500 });
  }
}

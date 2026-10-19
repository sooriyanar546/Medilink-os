/**
 * tests/patient_portal_unit.test.mjs
 *
 * Fast, pure Node.js unit test runner for all Patient Portal Services:
 * - SigTranslatorService
 * - ConsentVaultService helpers
 * - LabExplainerService
 * - QueueTrackingService
 * - ClinicalDietService
 * - RedFlagTriage
 * - VerifyConsentToken helpers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  translateSig,
  translateMedicationList,
  flagForPharmacistReview,
  formatScheduleBadge,
} from '../src/lib/services/SigTranslatorService.js';

import {
  formatBearerToken,
  extractJtiFromBearer,
  PURPOSE_CODES,
  DATA_TYPES,
} from '../src/lib/services/ConsentVaultService.js';

import {
  classifyBiomarker,
  quickClassify,
  CLINICAL_SAFETY_DISCLAIMER,
} from '../src/lib/services/LabExplainerService.js';

import {
  calculateETA,
  smoothVelocity,
  STAGE_PROGRESSION,
  STAGE_METADATA,
} from '../src/lib/services/QueueTrackingService.js';

import {
  resolveProtocol,
  getProtocolData,
} from '../src/lib/services/ClinicalDietService.js';

import {
  evaluateRedFlags,
} from '../src/lib/middleware/redFlagTriageMiddleware.js';

import {
  extractConsentToken,
} from '../src/lib/middleware/verifyConsentToken.js';

// ─── 1. SigTranslatorService ──────────────────────────────────────────────────
describe('SigTranslatorService (Deterministic Sig Translation)', () => {
  it('P-01: Translates BID with PC (Twice daily after meals)', () => {
    const { parsed, schedule } = translateSig('1 tab BID PC x 30d', 'Metformin', '500mg');
    assert.equal(parsed.frequency_code, 'BID');
    assert.equal(parsed.timing_code, 'PC');
    assert.equal(parsed.duration_days, 30);
    assert.equal(schedule.dose_slots.length, 2);
    assert.match(schedule.summary, /twice daily/i);
  });

  it('P-02: Translates TID AC (Three times daily before meals)', () => {
    const { parsed, schedule } = translateSig('5mL TID AC', 'Amoxicillin');
    assert.equal(parsed.frequency_code, 'TID');
    assert.equal(parsed.timing_code, 'AC');
    assert.equal(schedule.dose_slots.length, 3);
  });

  it('P-03: Handles PRN (as needed) instructions with trigger conditions', () => {
    const { parsed, schedule } = translateSig('1 tab PRN for pain', 'Ibuprofen', '400mg');
    assert.equal(parsed.is_prn, true);
    assert.equal(schedule.is_prn, true);
    assert.match(parsed.prn_condition, /pain/i);
  });

  it('P-04: Batch-translates list of patient medications', () => {
    const meds = [
      { drugName: 'Amlodipine', dosage: '5mg', frequency: 'QD', duration: '30 days' },
      { drugName: 'Paracetamol', dosage: '650mg', sig: '1 tab SOS/PRN for high fever' },
    ];
    const results = translateMedicationList(meds);
    assert.equal(results.length, 2);
    assert.equal(results[0].drug, 'Amlodipine');
    assert.equal(results[1].parsed.is_prn, true);
  });

  it('P-05: Flags unclear or unparsed sigs for pharmacist review', () => {
    const { parsed } = translateSig('take some whenever feeling odd', 'UnknownDrug');
    const review = flagForPharmacistReview(parsed);
    assert.equal(review.needs_review, true);
    assert.ok(review.reasons.length > 0);
  });

  it('P-06: Formats clean schedule badge for UI chips', () => {
    const { schedule } = translateSig('1 cap QD HS x 14d', 'Atorvastatin', '20mg');
    const badge = formatScheduleBadge(schedule);
    assert.equal(typeof badge, 'string');
    assert.ok(badge.length > 0);
  });
});

// ─── 2. ConsentVaultService Helpers ───────────────────────────────────────────
describe('ConsentVaultService Helpers', () => {
  it('P-07: Formats and extracts ABHA bearer token headers', () => {
    const jti = 'e9c8a1b2d3f4e5a6b7c8d9e0f1a2b3c4';
    const header = formatBearerToken(jti);
    assert.equal(header, `ABHA ${jti}`);

    const extracted = extractJtiFromBearer(header);
    assert.equal(extracted, jti);
  });

  it('P-08: Rejects invalid or empty bearer token strings', () => {
    assert.equal(extractJtiFromBearer(''), null);
    assert.equal(extractJtiFromBearer('Bearer xyz'), null);
    assert.equal(extractJtiFromBearer(null), null);
  });

  it('P-09: Validates ABDM purpose codes and resource data types', () => {
    assert.ok(PURPOSE_CODES.CARE_MANAGEMENT);
    assert.ok(PURPOSE_CODES.BREAK_THE_GLASS);
    assert.ok(DATA_TYPES.DIAGNOSTIC_REPORT);
    assert.ok(DATA_TYPES.PRESCRIPTION);
  });
});

// ─── 3. LabExplainerService ───────────────────────────────────────────────────
describe('LabExplainerService (Biomarker Evaluation & Ranges)', () => {
  it('P-10: Classifies normal biomarker within reference intervals', () => {
    const result = classifyBiomarker({
      name: 'Hemoglobin',
      value: 14.5,
      unit: 'g/dL',
      ref_low: 12.0,
      ref_high: 17.5,
    });
    assert.equal(result.severity, 'NORMAL');
    assert.equal(result.delta_percent, null);
  });

  it('P-11: Classifies HIGH biomarker exceeding reference intervals', () => {
    const result = classifyBiomarker({
      name: 'Fasting Blood Glucose',
      value: 160,
      unit: 'mg/dL',
      ref_low: 70,
      ref_high: 99,
    });
    assert.equal(result.severity, 'HIGH');
    assert.ok(result.delta_percent > 0);
  });

  it('P-12: Triggers CRITICAL severity for life-threatening values', () => {
    const result = classifyBiomarker({
      name: 'Hemoglobin',
      value: 5.8,
      unit: 'g/dL',
    });
    assert.equal(result.severity, 'CRITICAL');
  });

  it('P-13: Includes mandatory clinical safety disclaimer', () => {
    assert.match(CLINICAL_SAFETY_DISCLAIMER, /does not constitute medical advice/i);
  });
});

// ─── 4. QueueTrackingService ───────────────────────────────────────────────────
describe('QueueTrackingService (5-Stage Wayfinding & Dynamic ETA)', () => {
  it('P-14: Adheres to 5-stage Outpatient Department progression', () => {
    assert.equal(STAGE_PROGRESSION.ENTRANCE, 'TRIAGE');
    assert.equal(STAGE_PROGRESSION.TRIAGE, 'DOCTOR_ROOM');
    assert.equal(STAGE_PROGRESSION.DOCTOR_ROOM, 'PHARMACY');
    assert.equal(STAGE_PROGRESSION.PHARMACY, 'DISCHARGE');
    assert.equal(STAGE_PROGRESSION.DISCHARGE, null);
  });

  it('P-15: Calculates dynamic ETA from queue depth and provider velocity', () => {
    const eta = calculateETA('DOCTOR_ROOM', 3, 3.0);
    assert.ok(eta.total_eta_mins > 0);
    assert.ok(eta.total_eta_mins <= 120);
  });

  it('P-16: Smooths provider velocity spikes with exponential dampening', () => {
    const smoothed = smoothVelocity(3.0, 6.0);
    assert.ok(smoothed > 3.0);
    assert.ok(smoothed < 6.0);
  });

  it('P-17: Has chime audio flag configured on arrival stages', () => {
    assert.equal(STAGE_METADATA.DOCTOR_ROOM.chime, true);
    assert.equal(STAGE_METADATA.ENTRANCE.chime, false);
  });
});

// ─── 5. ClinicalDietService ───────────────────────────────────────────────────
describe('ClinicalDietService (Evidence-Based Condition Mapping)', () => {
  it('P-18: Maps Hypertension to DASH protocol', () => {
    const resolved = resolveProtocol(['Hypertension', 'Elevated BP']);
    assert.equal(resolved.protocol, 'DASH');
  });

  it('P-19: Maps Type 2 Diabetes to LOW_GI protocol', () => {
    const resolved = resolveProtocol(['Type 2 Diabetes Mellitus']);
    assert.equal(resolved.protocol, 'LOW_GI');
  });

  it('P-20: Maps Chronic Kidney Disease to RENAL protocol', () => {
    const resolved = resolveProtocol(['Chronic Kidney Disease Stage 3']);
    assert.equal(resolved.protocol, 'RENAL');
  });

  it('P-21: Maps Chemotherapy to NEUTROPENIC dietary precautions', () => {
    const resolved = resolveProtocol(['Chemotherapy cycle 2']);
    assert.equal(resolved.protocol, 'NEUTROPENIC');
  });

  it('P-22: Provides structured allowed and restricted food groups', () => {
    const dash = getProtocolData('DASH');
    assert.ok(dash);
    assert.match(dash.name, /DASH/i);
    assert.ok(dash.allowed_foods.food_groups.length > 0);
    assert.ok(dash.restricted_foods.food_groups.length > 0);
  });
});

// ─── 6. RedFlagTriageMiddleware ───────────────────────────────────────────────
describe('RedFlagTriageMiddleware (Emergency Detection)', () => {
  it('P-23: Detects crushing chest pain as CRITICAL_EMERGENCY', () => {
    const result = evaluateRedFlags('I am having crushing chest pain radiating to my left arm');
    assert.equal(result.isRedFlag, true);
    assert.equal(result.severity, 'CRITICAL_EMERGENCY');
    assert.match(result.guidance, /112|911/);
  });

  it('P-24: Detects stroke FAST symptoms as CRITICAL_EMERGENCY', () => {
    const result = evaluateRedFlags('Sudden facial droop and my right arm feels weak');
    assert.equal(result.isRedFlag, true);
    assert.equal(result.severity, 'CRITICAL_EMERGENCY');
  });

  it('P-25: Detects suicidal ideation and provides crisis hotlines', () => {
    const result = evaluateRedFlags('I have suicidal thoughts and want to die');
    assert.equal(result.isRedFlag, true);
    assert.equal(result.severity, 'CRITICAL_EMERGENCY');
    assert.match(result.guidance, /14416|988/);
  });

  it('P-26: Detects critical hypoxemia (SpO2 <= 88%) from vitals payload', () => {
    const result = evaluateRedFlags('Just feeling dizzy', { spo2: 84 });
    assert.equal(result.isRedFlag, true);
    assert.equal(result.severity, 'CRITICAL_EMERGENCY');
  });

  it('P-27: Correctly marks operational questions as ROUTINE', () => {
    const result = evaluateRedFlags('Where is Room 112 in Block C?');
    assert.equal(result.isRedFlag, false);
    assert.equal(result.severity, 'ROUTINE');
  });
});

// ─── 7. VerifyConsentMiddleware ───────────────────────────────────────────────
describe('VerifyConsentMiddleware (Token Extraction & Headers)', () => {
  it('P-28: Extracts token from X-Consent-Token custom header', () => {
    const mockReq = {
      headers: new Headers({ 'x-consent-token': 'token_abc123' }),
      url: 'http://localhost/api/patient/report',
    };
    assert.equal(extractConsentToken(mockReq), 'token_abc123');
  });

  it('P-29: Extracts token from ABHA Authorization header', () => {
    const mockReq = {
      headers: new Headers({ authorization: 'ABHA jti_998877' }),
      url: 'http://localhost/api/patient/report',
    };
    assert.equal(extractConsentToken(mockReq), 'jti_998877');
  });

  it('P-30: Extracts token from query parameters', () => {
    const mockReq = {
      headers: new Headers(),
      url: 'http://localhost/api/patient/report?consentToken=jti_query_1122',
    };
    assert.equal(extractConsentToken(mockReq), 'jti_query_1122');
  });
});

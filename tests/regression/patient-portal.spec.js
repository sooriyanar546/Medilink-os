import { test, expect } from '@playwright/test';

// Import Services & Middlewares
import {
  translateSig,
  translateMedicationList,
  flagForPharmacistReview,
  formatScheduleBadge,
} from '@/lib/services/SigTranslatorService.js';

import {
  formatBearerToken,
  extractJtiFromBearer,
  PURPOSE_CODES,
  DATA_TYPES,
} from '@/lib/services/ConsentVaultService.js';

import {
  classifyBiomarker,
  quickClassify,
  CLINICAL_SAFETY_DISCLAIMER,
} from '@/lib/services/LabExplainerService.js';

import {
  calculateETA,
  smoothVelocity,
  STAGE_PROGRESSION,
  STAGE_METADATA,
} from '@/lib/services/QueueTrackingService.js';

import {
  resolveProtocol,
  getProtocolData,
} from '@/lib/services/ClinicalDietService.js';

import {
  evaluateRedFlags,
} from '@/lib/middleware/redFlagTriageMiddleware.js';

import {
  extractConsentToken,
} from '@/lib/middleware/verifyConsentToken.js';

// =============================================================================
// Patient Portal Service Layer & Clinical Logic Suite
// =============================================================================

test.describe('SigTranslatorService (Deterministic Sig Translation)', () => {
  test('P-01: Translates BID with PC (Twice daily after meals)', () => {
    const { parsed, schedule } = translateSig('1 tab BID PC x 30d', 'Metformin', '500mg');
    expect(parsed.frequency_code).toBe('BID');
    expect(parsed.timing_code).toBe('PC');
    expect(parsed.duration_days).toBe(30);
    expect(schedule.dose_slots.length).toBe(2);
    expect(schedule.summary.toLowerCase()).toContain('twice daily');
  });

  test('P-02: Translates TID AC (Three times daily before meals)', () => {
    const { parsed, schedule } = translateSig('5mL TID AC', 'Amoxicillin');
    expect(parsed.frequency_code).toBe('TID');
    expect(parsed.timing_code).toBe('AC');
    expect(schedule.dose_slots.length).toBe(3);
  });

  test('P-03: Handles PRN (as needed) instructions with trigger conditions', () => {
    const { parsed, schedule } = translateSig('1 tab PRN for pain', 'Ibuprofen', '400mg');
    expect(parsed.is_prn).toBe(true);
    expect(schedule.is_prn).toBe(true);
    expect(parsed.prn_condition.toLowerCase()).toContain('pain');
  });

  test('P-04: Batch-translates list of patient medications', () => {
    const meds = [
      { drugName: 'Amlodipine', dosage: '5mg', frequency: 'QD', duration: '30 days' },
      { drugName: 'Paracetamol', dosage: '650mg', sig: '1 tab SOS/PRN for high fever' },
    ];
    const results = translateMedicationList(meds);
    expect(results.length).toBe(2);
    expect(results[0].drug).toBe('Amlodipine');
    expect(results[1].parsed.is_prn).toBe(true);
  });

  test('P-05: Flags unclear or unparsed sigs for pharmacist review', () => {
    const { parsed } = translateSig('take some whenever feeling odd', 'UnknownDrug');
    const review = flagForPharmacistReview(parsed);
    expect(review.needs_review).toBe(true);
    expect(review.reasons.length).toBeGreaterThan(0);
  });

  test('P-06: Formats clean schedule badge for UI chips', () => {
    const { schedule } = translateSig('1 cap QD HS x 14d', 'Atorvastatin', '20mg');
    const badge = formatScheduleBadge(schedule);
    expect(typeof badge).toBe('string');
    expect(badge.length).toBeGreaterThan(0);
  });
});

test.describe('ConsentVaultService Helpers', () => {
  test('P-07: Formats and extracts ABHA bearer token headers', () => {
    const jti = 'e9c8a1b2d3f4e5a6b7c8d9e0f1a2b3c4';
    const header = formatBearerToken(jti);
    expect(header).toBe(`ABHA ${jti}`);

    const extracted = extractJtiFromBearer(header);
    expect(extracted).toBe(jti);
  });

  test('P-08: Rejects invalid or empty bearer token strings', () => {
    expect(extractJtiFromBearer('')).toBeNull();
    expect(extractJtiFromBearer('Bearer xyz')).toBeNull();
    expect(extractJtiFromBearer(null)).toBeNull();
  });

  test('P-09: Validates ABDM purpose codes and resource data types', () => {
    expect(PURPOSE_CODES.CARE_MANAGEMENT).toBeTruthy();
    expect(PURPOSE_CODES.BREAK_THE_GLASS).toBeTruthy();
    expect(DATA_TYPES.DIAGNOSTIC_REPORT).toBeTruthy();
    expect(DATA_TYPES.PRESCRIPTION).toBeTruthy();
  });
});

test.describe('LabExplainerService (Biomarker Evaluation & Ranges)', () => {
  test('P-10: Classifies normal biomarker within reference intervals', () => {
    const result = classifyBiomarker({
      name: 'Hemoglobin',
      value: 14.5,
      unit: 'g/dL',
      ref_low: 12.0,
      ref_high: 17.5,
    });
    expect(result.severity).toBe('NORMAL');
    expect(result.delta_percent).toBeNull();
  });

  test('P-11: Classifies HIGH biomarker exceeding reference intervals', () => {
    const result = classifyBiomarker({
      name: 'Fasting Blood Glucose',
      value: 160,
      unit: 'mg/dL',
      ref_low: 70,
      ref_high: 99,
    });
    expect(result.severity).toBe('HIGH');
    expect(result.delta_percent).toBeGreaterThan(0);
  });

  test('P-12: Triggers CRITICAL severity for life-threatening values', () => {
    const result = classifyBiomarker({
      name: 'Hemoglobin',
      value: 5.8,
      unit: 'g/dL',
    });
    expect(result.severity).toBe('CRITICAL');
  });

  test('P-13: Includes mandatory clinical safety disclaimer', () => {
    expect(CLINICAL_SAFETY_DISCLAIMER).toMatch(/does not constitute medical advice/i);
  });
});

test.describe('QueueTrackingService (5-Stage Wayfinding & Dynamic ETA)', () => {
  test('P-14: Adheres to 5-stage Outpatient Department progression', () => {
    expect(STAGE_PROGRESSION.ENTRANCE).toBe('TRIAGE');
    expect(STAGE_PROGRESSION.TRIAGE).toBe('DOCTOR_ROOM');
    expect(STAGE_PROGRESSION.DOCTOR_ROOM).toBe('PHARMACY');
    expect(STAGE_PROGRESSION.PHARMACY).toBe('DISCHARGE');
    expect(STAGE_PROGRESSION.DISCHARGE).toBeNull();
  });

  test('P-15: Calculates dynamic ETA from queue depth and provider velocity', () => {
    const eta = calculateETA('DOCTOR_ROOM', 3, 3.0);
    expect(eta.total_eta_mins).toBeGreaterThan(0);
    expect(eta.total_eta_mins).toBeLessThanOrEqual(120);
  });

  test('P-16: Smooths provider velocity spikes with exponential dampening', () => {
    const smoothed = smoothVelocity(3.0, 6.0);
    expect(smoothed).toBeGreaterThan(3.0);
    expect(smoothed).toBeLessThan(6.0);
  });

  test('P-17: Has chime audio flag configured on arrival stages', () => {
    expect(STAGE_METADATA.DOCTOR_ROOM.chime).toBe(true);
    expect(STAGE_METADATA.ENTRANCE.chime).toBe(false);
  });
});

test.describe('ClinicalDietService (Evidence-Based Condition Mapping)', () => {
  test('P-18: Maps Hypertension to DASH protocol', () => {
    const resolved = resolveProtocol(['Hypertension', 'Elevated BP']);
    expect(resolved.protocol).toBe('DASH');
  });

  test('P-19: Maps Type 2 Diabetes to LOW_GI protocol', () => {
    const resolved = resolveProtocol(['Type 2 Diabetes Mellitus']);
    expect(resolved.protocol).toBe('LOW_GI');
  });

  test('P-20: Maps Chronic Kidney Disease to RENAL protocol', () => {
    const resolved = resolveProtocol(['Chronic Kidney Disease Stage 3']);
    expect(resolved.protocol).toBe('RENAL');
  });

  test('P-21: Maps Chemotherapy to NEUTROPENIC dietary precautions', () => {
    const resolved = resolveProtocol(['Chemotherapy cycle 2']);
    expect(resolved.protocol).toBe('NEUTROPENIC');
  });

  test('P-22: Provides structured allowed and restricted food groups', () => {
    const dash = getProtocolData('DASH');
    expect(dash).toBeTruthy();
    expect(dash.allowed_foods.food_groups.length).toBeGreaterThan(0);
    expect(dash.restricted_foods.food_groups.length).toBeGreaterThan(0);
  });
});

test.describe('RedFlagTriageMiddleware (Emergency Detection)', () => {
  test('P-23: Detects crushing chest pain as CRITICAL_EMERGENCY', () => {
    const result = evaluateRedFlags('I am having crushing chest pain radiating to my left arm');
    expect(result.isRedFlag).toBe(true);
    expect(result.severity).toBe('CRITICAL_EMERGENCY');
    expect(result.guidance).toMatch(/112|911/);
  });

  test('P-24: Detects stroke FAST symptoms as CRITICAL_EMERGENCY', () => {
    const result = evaluateRedFlags('Sudden facial droop and my right arm feels weak');
    expect(result.isRedFlag).toBe(true);
    expect(result.severity).toBe('CRITICAL_EMERGENCY');
  });

  test('P-25: Detects suicidal ideation and provides crisis hotlines', () => {
    const result = evaluateRedFlags('I have suicidal thoughts and want to die');
    expect(result.isRedFlag).toBe(true);
    expect(result.severity).toBe('CRITICAL_EMERGENCY');
    expect(result.guidance).toMatch(/14416|988/);
  });

  test('P-26: Detects critical hypoxemia (SpO2 <= 88%) from vitals payload', () => {
    const result = evaluateRedFlags('Just feeling dizzy', { spo2: 84 });
    expect(result.isRedFlag).toBe(true);
    expect(result.severity).toBe('CRITICAL_EMERGENCY');
  });

  test('P-27: Correctly marks operational questions as ROUTINE', () => {
    const result = evaluateRedFlags('Where is Room 112 in Block C?');
    expect(result.isRedFlag).toBe(false);
    expect(result.severity).toBe('ROUTINE');
  });
});

test.describe('VerifyConsentMiddleware (Token Extraction & Headers)', () => {
  test('P-28: Extracts token from X-Consent-Token custom header', () => {
    const mockReq = {
      headers: new Headers({ 'x-consent-token': 'token_abc123' }),
      url: 'http://localhost/api/patient/report',
    };
    expect(extractConsentToken(mockReq)).toBe('token_abc123');
  });

  test('P-29: Extracts token from ABHA Authorization header', () => {
    const mockReq = {
      headers: new Headers({ authorization: 'ABHA jti_998877' }),
      url: 'http://localhost/api/patient/report',
    };
    expect(extractConsentToken(mockReq)).toBe('jti_998877');
  });

  test('P-30: Extracts token from query parameters', () => {
    const mockReq = {
      headers: new Headers(),
      url: 'http://localhost/api/patient/report?consentToken=jti_query_1122',
    };
    expect(extractConsentToken(mockReq)).toBe('jti_query_1122');
  });
});

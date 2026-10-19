-- =============================================================================
-- Migration: 003_patient_portal_schema.sql
-- Module:    Patient Care Portal — Full Data Schema
-- Author:    MediLink Platform (Antigravity-generated)
-- Date:      2026-10-19
--
-- Tables introduced:
--   patient_journeys, queue_tickets
--   biomarker_results (extends existing LabReport via patientId)
--   prescriptions, medication_items
--   abha_consent_artifacts, consent_audit_log
--   nutrition_plans, dietitian_appointments
--
-- NOTE: This migration is additive only. It does NOT drop or alter any column
--       introduced in migrations 001 or 002.
-- =============================================================================

-- ============================================================
-- SECTION 1: PATIENT JOURNEYS — Real-Time Wayfinding
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journey_stage') THEN
    CREATE TYPE journey_stage AS ENUM (
      'ENTRANCE',
      'TRIAGE',
      'DOCTOR_ROOM',
      'PHARMACY',
      'DISCHARGE'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journey_status') THEN
    CREATE TYPE journey_status AS ENUM (
      'ACTIVE',
      'COMPLETED',
      'CANCELLED',
      'ABANDONED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS patient_journeys (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id          TEXT        NOT NULL,          -- FK → "Patient".id (Prisma cuid)
  visit_id            TEXT        UNIQUE,            -- FK → "Visit".id; nullable for walk-ins
  current_stage       journey_stage NOT NULL DEFAULT 'ENTRANCE',
  status              journey_status NOT NULL DEFAULT 'ACTIVE',

  -- Provider velocity sample used to compute dynamic ETA
  -- Stored as consultations-per-hour of the assigned doctor at snapshot time
  provider_velocity   NUMERIC(5,2) DEFAULT 3.0,

  -- Queue sequence within the current stage
  stage_queue_position INT         DEFAULT 1,

  -- Timestamps for each stage entry — NULL until the patient reaches that stage
  entered_entrance_at TIMESTAMPTZ,
  entered_triage_at   TIMESTAMPTZ,
  entered_doctor_at   TIMESTAMPTZ,
  entered_pharmacy_at TIMESTAMPTZ,
  discharged_at       TIMESTAMPTZ,

  -- Pusher last-emitted event payload (stored for client reconnect hydration)
  last_event_payload  JSONB,

  -- Discharge milestone HUD bitmask fields
  doctor_clearance        BOOLEAN NOT NULL DEFAULT FALSE,
  pharmacy_dispensation   BOOLEAN NOT NULL DEFAULT FALSE,
  billing_reconciliation  BOOLEAN NOT NULL DEFAULT FALSE,
  transporter_assigned    BOOLEAN NOT NULL DEFAULT FALSE,
  bed_released            BOOLEAN NOT NULL DEFAULT FALSE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite indexes for high-throughput patient-specific active-journey lookups
CREATE INDEX IF NOT EXISTS idx_journeys_patient_status
  ON patient_journeys (patient_id, status);

CREATE INDEX IF NOT EXISTS idx_journeys_visit
  ON patient_journeys (visit_id)
  WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journeys_active_stage
  ON patient_journeys (current_stage, status)
  WHERE status = 'ACTIVE';

-- ============================================================
-- SECTION 2: QUEUE TICKETS — Stage-Specific Position Tracking
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
    CREATE TYPE ticket_status AS ENUM (
      'PENDING',
      'CALLED',
      'SERVING',
      'DONE',
      'SKIPPED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS queue_tickets (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  journey_id          TEXT        NOT NULL REFERENCES patient_journeys(id) ON DELETE CASCADE,
  patient_id          TEXT        NOT NULL,
  stage               journey_stage NOT NULL,
  ticket_number       TEXT        NOT NULL,           -- Human-readable: e.g., "T-042", "D-017"
  position            INT         NOT NULL,
  status              ticket_status NOT NULL DEFAULT 'PENDING',
  estimated_wait_mins INT,                            -- Dynamically recalculated on each dequeue
  called_at           TIMESTAMPTZ,
  served_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Enforce uniqueness of one active ticket per patient per stage
  CONSTRAINT uq_active_ticket_per_patient_stage UNIQUE (patient_id, stage, status)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_tickets_journey
  ON queue_tickets (journey_id);

CREATE INDEX IF NOT EXISTS idx_tickets_stage_status
  ON queue_tickets (stage, status, position);

CREATE INDEX IF NOT EXISTS idx_tickets_patient_active
  ON queue_tickets (patient_id, status)
  WHERE status IN ('PENDING', 'CALLED', 'SERVING');

-- ============================================================
-- SECTION 3: BIOMARKER RESULTS — Structured Lab Line Items
-- ============================================================
-- Extends the existing "LabReport" model (which stores aggregate plainEnglish).
-- Each row here is one measurable biomarker within a report.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'biomarker_severity') THEN
    CREATE TYPE biomarker_severity AS ENUM ('NORMAL', 'LOW', 'HIGH', 'CRITICAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS biomarker_results (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  lab_report_id       TEXT        NOT NULL,           -- FK → "LabReport".id (Prisma model)
  patient_id          TEXT        NOT NULL,

  -- Biomarker identity
  name                TEXT        NOT NULL,           -- e.g., "Hemoglobin", "Serum Creatinine"
  abbreviation        TEXT,                           -- e.g., "Hgb", "Cr"
  panel               TEXT,                           -- e.g., "CBC", "BMP", "LFT"

  -- Measured & reference values
  measured_value      NUMERIC(12,4) NOT NULL,
  unit                TEXT        NOT NULL,           -- e.g., "g/dL", "mg/dL", "U/L"
  ref_low             NUMERIC(12,4),                  -- Lower bound of normal range
  ref_high            NUMERIC(12,4),                  -- Upper bound of normal range
  ref_text            TEXT,                           -- e.g., "< 200 mg/dL" for non-numeric refs

  -- AI/rule evaluation outputs
  severity            biomarker_severity NOT NULL DEFAULT 'NORMAL',
  delta_percent       NUMERIC(6,2),                   -- % deviation from nearest reference bound
  plain_explanation   TEXT,                           -- Plain-English AI explanation for this marker
  urgent_consultation_required BOOLEAN NOT NULL DEFAULT FALSE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biomarkers_report
  ON biomarker_results (lab_report_id);

CREATE INDEX IF NOT EXISTS idx_biomarkers_patient_severity
  ON biomarker_results (patient_id, severity)
  WHERE severity IN ('HIGH', 'CRITICAL');

-- ============================================================
-- SECTION 4: PRESCRIPTIONS & MEDICATION ITEMS
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rx_status') THEN
    CREATE TYPE rx_status AS ENUM (
      'ACTIVE',
      'COMPLETED',
      'DISCONTINUED',
      'ON_HOLD'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prescriptions (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id          TEXT        NOT NULL,
  visit_id            TEXT,                           -- nullable; may be issued without a visit
  clinical_note_id    TEXT,                           -- FK → "ClinicalNote".id
  prescribed_by       TEXT        NOT NULL,           -- Doctor user ID
  prescribed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              rx_status   NOT NULL DEFAULT 'ACTIVE',
  pharmacy_status     TEXT        NOT NULL DEFAULT 'PENDING',  -- PENDING, PREPARING, READY, DISPENSED
  raw_sig_text        TEXT,                           -- Original prescription note verbatim
  notes               TEXT,                           -- Free-form clinical notes
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rx_patient_status
  ON prescriptions (patient_id, status);

CREATE INDEX IF NOT EXISTS idx_rx_visit
  ON prescriptions (visit_id)
  WHERE visit_id IS NOT NULL;

-- Individual medication line items within a prescription
CREATE TABLE IF NOT EXISTS medication_items (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  prescription_id     TEXT        NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  patient_id          TEXT        NOT NULL,

  -- Drug identification
  drug_name           TEXT        NOT NULL,           -- e.g., "Metformin"
  brand_name          TEXT,                           -- e.g., "Glucophage"
  dosage_strength     TEXT        NOT NULL,           -- e.g., "500mg"
  dosage_form         TEXT,                           -- e.g., "Tablet", "Capsule", "Syrup"

  -- Raw & parsed Sig instruction
  raw_sig             TEXT        NOT NULL,           -- Original sig: e.g., "1 tab BID PC x 30d"
  quantity            TEXT,                           -- e.g., "1 tablet", "5 mL"
  frequency_code      TEXT,                           -- Normalised: BID, TID, QD, PRN, etc.
  timing_code         TEXT,                           -- AC, PC, HS, STAT, etc.
  route_code          TEXT,                           -- PO, IV, IM, SL, TOP
  duration_days       INT,
  duration_text       TEXT,                           -- e.g., "30 days"
  refills_remaining   INT         DEFAULT 0,
  is_prn              BOOLEAN     NOT NULL DEFAULT FALSE,
  prn_condition       TEXT,                           -- e.g., "for pain", "for fever above 101°F"

  -- Translated schedule (output of SigTranslatorService)
  translated_schedule JSONB,                          -- Structured human-friendly schedule object
  max_daily_dose      TEXT,                           -- e.g., "1000mg/day"

  -- Safety flags
  allergy_flag        BOOLEAN     NOT NULL DEFAULT FALSE,
  allergy_note        TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_med_items_prescription
  ON medication_items (prescription_id);

CREATE INDEX IF NOT EXISTS idx_med_items_patient
  ON medication_items (patient_id);

CREATE INDEX IF NOT EXISTS idx_med_items_prn
  ON medication_items (patient_id, is_prn)
  WHERE is_prn = TRUE;

-- ============================================================
-- SECTION 5: ABHA CONSENT ARTIFACTS & AUDIT LOG
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'abha_consent_status') THEN
    CREATE TYPE abha_consent_status AS ENUM (
      'REQUESTED',
      'GRANTED',
      'REVOKED',
      'EXPIRED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS abha_consent_artifacts (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id          TEXT        NOT NULL,
  requester_id        TEXT        NOT NULL,           -- Doctor/user requesting consent
  requester_role      TEXT        NOT NULL,           -- e.g., 'DOCTOR', 'ADMIN'

  -- ABDM-mandated consent fields
  purpose_code        TEXT        NOT NULL,           -- e.g., 'CARE_MANAGEMENT', 'RESEARCH', 'SELF_REQUESTED'
  data_types          TEXT[]      NOT NULL,           -- e.g., ARRAY['DiagnosticReport','Prescription']
  date_range_start    TIMESTAMPTZ,                    -- EHR records valid from this date
  date_range_end      TIMESTAMPTZ,                    -- EHR records valid to this date
  expiry_timestamp    TIMESTAMPTZ NOT NULL,           -- Consent token hard expiry

  -- Cryptographic token
  token_signature     TEXT        NOT NULL,           -- HMAC-SHA256 hex signature
  token_payload_hash  TEXT        NOT NULL,           -- SHA-256 of original payload (audit integrity)
  token_jti           TEXT        UNIQUE NOT NULL,    -- JWT-style unique token ID (nonce)

  -- Lifecycle state
  status              abha_consent_status NOT NULL DEFAULT 'REQUESTED',
  granted_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  revocation_reason   TEXT,

  -- Scoped access constraints
  scope_restriction   JSONB,                          -- e.g., {"visitIds": ["v1","v2"]}

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abha_patient_status
  ON abha_consent_artifacts (patient_id, status);

CREATE INDEX IF NOT EXISTS idx_abha_requester
  ON abha_consent_artifacts (requester_id, status);

CREATE INDEX IF NOT EXISTS idx_abha_expiry
  ON abha_consent_artifacts (expiry_timestamp)
  WHERE status = 'GRANTED';

CREATE INDEX IF NOT EXISTS idx_abha_jti
  ON abha_consent_artifacts (token_jti);

-- Immutable append-only consent audit log
CREATE TABLE IF NOT EXISTS consent_audit_log (
  id                  BIGSERIAL   PRIMARY KEY,
  artifact_id         TEXT        NOT NULL REFERENCES abha_consent_artifacts(id),
  patient_id          TEXT        NOT NULL,
  actor_id            TEXT        NOT NULL,           -- Who performed the action
  actor_role          TEXT        NOT NULL,
  action              TEXT        NOT NULL,           -- GRANT, REVOKE, VERIFY, EXPIRE, ACCESS
  outcome             TEXT        NOT NULL,           -- SUCCESS, FAILURE, DENIED
  client_ip           INET,
  user_agent          TEXT,
  details             JSONB,
  logged_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_audit_artifact
  ON consent_audit_log (artifact_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_consent_audit_patient
  ON consent_audit_log (patient_id, logged_at DESC);

-- Prevent UPDATE/DELETE on consent_audit_log (append-only enforcement)
CREATE OR REPLACE FUNCTION fn_prevent_consent_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent_audit_log is append-only. Mutations are not permitted. (HIPAA § 164.312(b))';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_consent_audit_update ON consent_audit_log;
CREATE TRIGGER trg_prevent_consent_audit_update
  BEFORE UPDATE OR DELETE ON consent_audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_consent_audit_mutation();

-- ============================================================
-- SECTION 6: CLINICAL NUTRITION PLANS & DIETITIAN APPOINTMENTS
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diet_protocol') THEN
    CREATE TYPE diet_protocol AS ENUM (
      'DASH',                 -- Hypertension
      'LOW_GI',               -- Type 2 Diabetes
      'RENAL',                -- CKD / Dialysis
      'CARDIAC',              -- Post-MI, Heart Failure
      'HIGH_PROTEIN_SOFT',    -- Post-Op Recovery
      'LOW_FAT',              -- Dyslipidaemia
      'ANTI_INFLAMMATORY',    -- Autoimmune / IBD
      'NEUTROPENIC',          -- Immunocompromised (Chemotherapy)
      'TEXTURE_MODIFIED',     -- Dysphagia
      'STANDARD_BALANCED'     -- General / Preventive
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS nutrition_plans (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id          TEXT        NOT NULL,
  visit_id            TEXT,
  prescribed_by       TEXT        NOT NULL,           -- Doctor user ID or dietitian ID
  protocol            diet_protocol NOT NULL DEFAULT 'STANDARD_BALANCED',

  -- Linked conditions (what drove this protocol selection)
  conditions          TEXT[]      NOT NULL DEFAULT '{}',  -- e.g., ARRAY['HYPERTENSION','CKD']

  -- Structured plan content (output of ClinicalDietService)
  allowed_foods       JSONB,                          -- { food_groups: [...], examples: [...] }
  restricted_foods    JSONB,                          -- { food_groups: [...], reasons: {...} }
  daily_targets       JSONB,                          -- { calories: 1800, protein_g: 80, ... }
  meal_timing_tips    JSONB,                          -- Array of tip strings per meal slot
  hydration_ml        INT         DEFAULT 2000,
  supplement_notes    TEXT,
  emergency_foods     TEXT[],                         -- Foods allowed without restriction (fast emergency re-feeding)
  notes               TEXT,

  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  valid_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_patient_active
  ON nutrition_plans (patient_id, is_active)
  WHERE is_active = TRUE;

-- Dietitian appointment reservation
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appt_status') THEN
    CREATE TYPE appt_status AS ENUM (
      'PENDING',
      'CONFIRMED',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dietitian_appointments (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id          TEXT        NOT NULL,
  nutrition_plan_id   TEXT        REFERENCES nutrition_plans(id),
  dietitian_id        TEXT,                           -- StaffMember ID or external dietitian
  dietitian_name      TEXT        NOT NULL,

  -- Scheduling
  slot_start          TIMESTAMPTZ NOT NULL,
  slot_end            TIMESTAMPTZ NOT NULL,
  timezone            TEXT        NOT NULL DEFAULT 'Asia/Kolkata',
  location            TEXT,                           -- e.g., "Dietetics Dept — Room 112" or "Telehealth"
  mode                TEXT        NOT NULL DEFAULT 'IN_PERSON', -- IN_PERSON, TELEHEALTH

  status              appt_status NOT NULL DEFAULT 'PENDING',
  cancellation_reason TEXT,
  notes               TEXT,

  -- Calendar booking metadata
  calendar_event_id   TEXT,                           -- External calendar integration ref

  booked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent double-booking of the same dietitian slot
  CONSTRAINT uq_dietitian_slot UNIQUE (dietitian_id, slot_start)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_dietitian_appt_patient
  ON dietitian_appointments (patient_id, status);

CREATE INDEX IF NOT EXISTS idx_dietitian_appt_slot
  ON dietitian_appointments (dietitian_id, slot_start)
  WHERE status IN ('PENDING', 'CONFIRMED');

CREATE INDEX IF NOT EXISTS idx_dietitian_appt_upcoming
  ON dietitian_appointments (slot_start)
  WHERE status IN ('PENDING', 'CONFIRMED');

-- ============================================================
-- SECTION 7: AUTO-EXPIRE ABHA CONSENT TOKENS (Scheduled-safe)
-- ============================================================
-- This function marks GRANTED consent artifacts as EXPIRED if
-- expiry_timestamp has passed. Call from a cron/scheduler job.

CREATE OR REPLACE FUNCTION fn_expire_abha_consents()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  expired_count INT;
BEGIN
  UPDATE abha_consent_artifacts
    SET status = 'EXPIRED', updated_at = NOW()
    WHERE status = 'GRANTED'
      AND expiry_timestamp <= NOW();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- ============================================================
-- SECTION 8: updated_at AUTO-MAINTENANCE TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_journeys ON patient_journeys;
CREATE TRIGGER trg_touch_journeys
  BEFORE UPDATE ON patient_journeys
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_prescriptions ON prescriptions;
CREATE TRIGGER trg_touch_prescriptions
  BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_abha_artifacts ON abha_consent_artifacts;
CREATE TRIGGER trg_touch_abha_artifacts
  BEFORE UPDATE ON abha_consent_artifacts
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_nutrition_plans ON nutrition_plans;
CREATE TRIGGER trg_touch_nutrition_plans
  BEFORE UPDATE ON nutrition_plans
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_dietitian_appts ON dietitian_appointments;
CREATE TRIGGER trg_touch_dietitian_appts
  BEFORE UPDATE ON dietitian_appointments
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- =============================================================================
-- END OF MIGRATION 003
-- =============================================================================

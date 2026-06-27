-- ============================================================
-- MEDILINK HIPAA-ALIGNED ROW LEVEL SECURITY POLICIES
-- Target: Neon PostgreSQL (native PostgreSQL 16 RLS)
-- Apply: psql $DATABASE_URL -f prisma/migrations/001_rls_policies.sql
--
-- SECURITY MODEL (two-layer defence in depth):
--   Layer 1 → Application (withRoleGuard.js) — blocks at HTTP
--   Layer 2 → Database (this file)           — blocks at SQL
--
-- RLS is evaluated AFTER the Prisma query reaches Postgres.
-- The API layer injects session variables via SET LOCAL inside
-- every transaction:  app.current_role, app.current_user_id,
-- app.current_patient_id, app.current_doctor_id
-- ============================================================

-- ─── ENABLE RLS on all PHI-bearing tables ───────────────────
ALTER TABLE "Patient"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VitalLog"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Visit"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicalNote"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LabReport"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BlockchainRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingClaim"   ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the DB owner role (prevents privilege escalation)
ALTER TABLE "Patient"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "VitalLog"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "Visit"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "ClinicalNote"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "LabReport"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "PatientConsent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "BlockchainRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Message"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "BillingClaim"   FORCE ROW LEVEL SECURITY;

-- ─── HELPER FUNCTION: current session role ──────────────────
-- Returns the role string set by the application layer.
-- Returns '' (empty) if not set — which matches no policy → access denied.
CREATE OR REPLACE FUNCTION current_medilink_role()
RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_role', true), '');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_medilink_patient_id()
RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_patient_id', true), '');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_medilink_doctor_id()
RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_doctor_id', true), '');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_medilink_user_id()
RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_user_id', true), '');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- PATIENT TABLE POLICIES
-- ============================================================

-- DROP existing policies if re-running (idempotent)
DROP POLICY IF EXISTS patient_select_own        ON "Patient";
DROP POLICY IF EXISTS doctor_select_assigned    ON "Patient";
DROP POLICY IF EXISTS admin_select_all          ON "Patient";
DROP POLICY IF EXISTS nurse_select_all          ON "Patient";
DROP POLICY IF EXISTS patient_update_own        ON "Patient";
DROP POLICY IF EXISTS staff_update_patient      ON "Patient";
DROP POLICY IF EXISTS no_patient_delete         ON "Patient";

-- Patients can only read their own record
CREATE POLICY patient_select_own ON "Patient"
  FOR SELECT USING (
    current_medilink_role() = 'PATIENT'
    AND id = current_medilink_patient_id()
  );

-- Doctors can read patients assigned to them (have an active/historical visit)
CREATE POLICY doctor_select_assigned ON "Patient"
  FOR SELECT USING (
    current_medilink_role() = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM "Visit" v
      WHERE v."patientId" = "Patient".id
        AND v."doctorId" = current_medilink_doctor_id()
    )
  );

-- Admin/Nurse/Cashier can read all patients (needed for scheduling)
CREATE POLICY admin_select_all ON "Patient"
  FOR SELECT USING (
    current_medilink_role() IN ('ADMIN', 'NURSE', 'CASHIER', 'PHARMACIST')
  );

-- Patients can update their own demographic data
CREATE POLICY patient_update_own ON "Patient"
  FOR UPDATE USING (
    current_medilink_role() = 'PATIENT'
    AND id = current_medilink_patient_id()
  );

-- Admins and Nurses can update any patient record (triage, registration)
CREATE POLICY staff_update_patient ON "Patient"
  FOR UPDATE USING (
    current_medilink_role() IN ('ADMIN', 'NURSE')
  );

-- HIPAA §164.312: No role can delete patient records (retention requirement)
CREATE POLICY no_patient_delete ON "Patient"
  FOR DELETE USING (false);

-- ============================================================
-- VITAL LOG TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS patient_own_vitals_all     ON "VitalLog";
DROP POLICY IF EXISTS nurse_log_vitals           ON "VitalLog";
DROP POLICY IF EXISTS doctor_read_consented_vitals ON "VitalLog";
DROP POLICY IF EXISTS no_vital_delete_doctor     ON "VitalLog";

-- Patients: full CRUD on their own vital logs
CREATE POLICY patient_own_vitals_all ON "VitalLog"
  FOR ALL USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  ) WITH CHECK (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

-- Nurses: can insert/update vitals for any patient (clinical recording)
CREATE POLICY nurse_log_vitals ON "VitalLog"
  FOR INSERT WITH CHECK (
    current_medilink_role() = 'NURSE'
  );

-- Doctors: READ-ONLY on vitals for patients who have granted CLINICAL consent
-- Doctors CANNOT insert/update/delete patient vitals
CREATE POLICY doctor_read_consented_vitals ON "VitalLog"
  FOR SELECT USING (
    current_medilink_role() = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM "PatientConsent" pc
      WHERE pc."patientId" = "VitalLog"."patientId"
        AND (pc."accessorId" = current_medilink_doctor_id() OR pc."accessorId" = '*')
        AND pc."accessLevel" = 'CLINICAL'
        AND pc.status = 'ACTIVE'
        AND pc."expiresAt" > NOW()
    )
  );

-- ADMINS: CANNOT read clinical vitals (HIPAA Minimum Necessary §164.514)
-- No SELECT policy for ADMIN = no access

-- ============================================================
-- VISIT TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS patient_own_visits         ON "Visit";
DROP POLICY IF EXISTS doctor_own_queue           ON "Visit";
DROP POLICY IF EXISTS admin_visits_full          ON "Visit";
DROP POLICY IF EXISTS nurse_visits_full          ON "Visit";
DROP POLICY IF EXISTS doctor_no_delete_visits    ON "Visit";

-- Patients: read their own visit history only
CREATE POLICY patient_own_visits ON "Visit"
  FOR SELECT USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

-- Doctors: full access to their own queue (their doctorId)
CREATE POLICY doctor_own_queue ON "Visit"
  FOR SELECT USING (
    current_medilink_role() = 'DOCTOR'
    AND "doctorId" = current_medilink_doctor_id()
  );

CREATE POLICY doctor_update_own_queue ON "Visit"
  FOR UPDATE USING (
    current_medilink_role() = 'DOCTOR'
    AND "doctorId" = current_medilink_doctor_id()
  );

-- Doctors CANNOT delete visits (immutable audit chain)
CREATE POLICY doctor_no_delete_visits ON "Visit"
  FOR DELETE USING (
    current_medilink_role() NOT IN ('PATIENT', 'DOCTOR')
    AND current_medilink_role() = 'ADMIN'
  );

-- Nurses: create visits (patient check-in) and read all visits
CREATE POLICY nurse_visits_full ON "Visit"
  FOR ALL USING (
    current_medilink_role() = 'NURSE'
  ) WITH CHECK (
    current_medilink_role() = 'NURSE'
  );

-- Admins: full access (scheduling, reporting)
CREATE POLICY admin_visits_full ON "Visit"
  FOR ALL USING (
    current_medilink_role() = 'ADMIN'
  ) WITH CHECK (
    current_medilink_role() = 'ADMIN'
  );

-- ============================================================
-- CLINICAL NOTE TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS doctor_own_clinical_notes   ON "ClinicalNote";
DROP POLICY IF EXISTS patient_read_own_notes      ON "ClinicalNote";

-- Doctors: full access to notes they authored (linked via Visit)
CREATE POLICY doctor_own_clinical_notes ON "ClinicalNote"
  FOR ALL USING (
    current_medilink_role() = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM "Visit" v
      WHERE v.id = "ClinicalNote"."visitId"
        AND v."doctorId" = current_medilink_doctor_id()
    )
  );

-- Patients: read-only access to their own clinical notes
CREATE POLICY patient_read_own_notes ON "ClinicalNote"
  FOR SELECT USING (
    current_medilink_role() = 'PATIENT'
    AND EXISTS (
      SELECT 1 FROM "Visit" v
      WHERE v.id = "ClinicalNote"."visitId"
        AND v."patientId" = current_medilink_patient_id()
    )
  );

-- ADMINS: No access to clinical notes (minimum necessary principle)
-- PHARMACY: read notes only for dispensing (via PHARMACY role check)
CREATE POLICY pharmacist_read_notes ON "ClinicalNote"
  FOR SELECT USING (
    current_medilink_role() = 'PHARMACIST'
  );

-- ============================================================
-- LAB REPORT TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS patient_own_lab_reports   ON "LabReport";
DROP POLICY IF EXISTS doctor_assigned_lab       ON "LabReport";
DROP POLICY IF EXISTS admin_no_lab_reports      ON "LabReport";

-- Patients: see only their own lab reports
CREATE POLICY patient_own_lab_reports ON "LabReport"
  FOR SELECT USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

-- Doctors: see lab reports for their patients
CREATE POLICY doctor_assigned_lab ON "LabReport"
  FOR ALL USING (
    current_medilink_role() = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM "Visit" v
      WHERE v."patientId" = "LabReport"."patientId"
        AND v."doctorId" = current_medilink_doctor_id()
    )
  );

-- Nurses can insert lab reports (ordered by doctors)
CREATE POLICY nurse_insert_lab ON "LabReport"
  FOR INSERT WITH CHECK (
    current_medilink_role() IN ('NURSE', 'ADMIN')
  );

-- Admins cannot read lab reports (PHI minimisation)
-- No policy for ADMIN = no SELECT access

-- ============================================================
-- PATIENT CONSENT TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS patient_manage_own_consent   ON "PatientConsent";
DROP POLICY IF EXISTS doctor_view_own_consents     ON "PatientConsent";
DROP POLICY IF EXISTS admin_view_all_consents      ON "PatientConsent";

-- Patients: full control of their own consent records
CREATE POLICY patient_manage_own_consent ON "PatientConsent"
  FOR ALL USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  ) WITH CHECK (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

-- Doctors: read consents where they are the accessor
CREATE POLICY doctor_view_own_consents ON "PatientConsent"
  FOR SELECT USING (
    current_medilink_role() = 'DOCTOR'
    AND ("accessorId" = current_medilink_doctor_id() OR "accessorId" = '*')
    AND status = 'ACTIVE'
    AND "expiresAt" > NOW()
  );

-- Admins: read all consent records (compliance auditing)
CREATE POLICY admin_view_all_consents ON "PatientConsent"
  FOR SELECT USING (
    current_medilink_role() = 'ADMIN'
  );

-- ============================================================
-- AUDIT LOG TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS all_insert_audit   ON "AuditLog";
DROP POLICY IF EXISTS admin_read_audit   ON "AuditLog";
DROP POLICY IF EXISTS no_update_audit    ON "AuditLog";
DROP POLICY IF EXISTS no_delete_audit    ON "AuditLog";

-- All roles can INSERT audit logs (append-only HIPAA trail)
CREATE POLICY all_insert_audit ON "AuditLog"
  FOR INSERT WITH CHECK (true);

-- Only Admins can read audit logs
CREATE POLICY admin_read_audit ON "AuditLog"
  FOR SELECT USING (
    current_medilink_role() = 'ADMIN'
  );

-- Nobody can UPDATE or DELETE audit logs (immutability guarantee)
CREATE POLICY no_update_audit ON "AuditLog"
  FOR UPDATE USING (false);

CREATE POLICY no_delete_audit ON "AuditLog"
  FOR DELETE USING (false);

-- ============================================================
-- BLOCKCHAIN RECORD TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS patient_own_blockchain ON "BlockchainRecord";
DROP POLICY IF EXISTS doctor_shared_blockchain ON "BlockchainRecord";

CREATE POLICY patient_own_blockchain ON "BlockchainRecord"
  FOR ALL USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

CREATE POLICY doctor_shared_blockchain ON "BlockchainRecord"
  FOR SELECT USING (
    current_medilink_role() = 'DOCTOR'
    AND "sharedWith"::jsonb ? current_medilink_doctor_id()
  );

-- ============================================================
-- MESSAGE TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS patient_own_messages ON "Message";
DROP POLICY IF EXISTS staff_send_messages  ON "Message";

CREATE POLICY patient_own_messages ON "Message"
  FOR SELECT USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

CREATE POLICY staff_send_messages ON "Message"
  FOR INSERT WITH CHECK (
    current_medilink_role() IN ('ADMIN', 'NURSE', 'DOCTOR')
  );

-- ============================================================
-- BILLING CLAIM TABLE POLICIES
-- ============================================================

DROP POLICY IF EXISTS admin_billing_full   ON "BillingClaim";
DROP POLICY IF EXISTS cashier_billing_full ON "BillingClaim";
DROP POLICY IF EXISTS patient_own_billing  ON "BillingClaim";

-- Admin and Cashier: full billing access
CREATE POLICY admin_billing_full ON "BillingClaim"
  FOR ALL USING (
    current_medilink_role() IN ('ADMIN', 'CASHIER')
  ) WITH CHECK (
    current_medilink_role() IN ('ADMIN', 'CASHIER')
  );

-- Patients: view their own billing claims only
CREATE POLICY patient_own_billing ON "BillingClaim"
  FOR SELECT USING (
    current_medilink_role() = 'PATIENT'
    AND EXISTS (
      SELECT 1 FROM "Visit" v
      WHERE v.id = "BillingClaim"."visitId"
        AND v."patientId" = current_medilink_patient_id()
    )
  );

-- ============================================================
-- VERIFICATION QUERIES (run after applying to validate)
-- ============================================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

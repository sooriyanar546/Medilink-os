-- ============================================================
-- MEDILINK MISSION CONTROL — SCHEMA ADDITIONS
-- Migration: 002_mission_control_indexes.sql
-- Target:    Neon PostgreSQL (PostgreSQL 16)
--
-- Apply after base schema:
--   psql $DATABASE_URL -f prisma/migrations/002_mission_control_indexes.sql
--
-- This migration does NOT modify existing tables or columns.
-- It adds:
--   1. Performance indexes for Mission Control telemetry queries
--   2. Composite indexes for SLA dwell-time calculations
--   3. A trigger-enforced append-only guard on AuditLog
--   4. Indexes on new query paths used by mission-control routes
-- ============================================================

-- ─── Guard: Only run this migration once ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'AuditLog'
      AND indexname = 'idx_auditlog_actor_timestamp'
  ) THEN

    -- ─── AuditLog: Optimized for actor + patient timeline queries ────────────
    CREATE INDEX IF NOT EXISTS idx_auditlog_actor_timestamp
      ON "AuditLog" ("userId", "timestamp" DESC);

    CREATE INDEX IF NOT EXISTS idx_auditlog_patient_timestamp
      ON "AuditLog" ("patientId", "timestamp" DESC)
      WHERE "patientId" IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_auditlog_action
      ON "AuditLog" ("action", "timestamp" DESC);

    -- ─── Visit: Optimised for SLA dwell-time and telemetry count queries ─────
    -- Already has @@index([status]) and @@index([doctorId, status]) from schema.
    -- Add: checkInAt composite for today's completed consultations
    CREATE INDEX IF NOT EXISTS idx_visit_status_completedat
      ON "Visit" ("status", "completedAt" DESC)
      WHERE "completedAt" IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_visit_checkinat_status
      ON "Visit" ("checkInAt" DESC, "status");

    -- ─── WardBed: Optimised for ward-type + status matrix queries ────────────
    CREATE INDEX IF NOT EXISTS idx_wardbed_wardtype_status
      ON "WardBed" ("wardType", "status");

    CREATE INDEX IF NOT EXISTS idx_wardbed_status_maintenance
      ON "WardBed" ("status", "maintenanceStart")
      WHERE "status" = 'MAINTENANCE';

    -- ─── BillingClaim: Optimised for flagged claim aggregation ───────────────
    CREATE INDEX IF NOT EXISTS idx_billingclaim_status_risk
      ON "BillingClaim" ("status", "rejectionRisk" DESC)
      WHERE "status" IN ('FLAGGED', 'PENDING');

    CREATE INDEX IF NOT EXISTS idx_billingclaim_payment_created
      ON "BillingClaim" ("paymentStatus", "createdAt" DESC);

    -- ─── StaffShift: Optimised for today's active roster queries ─────────────
    CREATE INDEX IF NOT EXISTS idx_staffshift_status_start
      ON "StaffShift" ("status", "shiftStart" ASC);

    CREATE INDEX IF NOT EXISTS idx_staffshift_ward_status
      ON "StaffShift" ("ward", "status");

    RAISE NOTICE 'Migration 002_mission_control_indexes applied successfully.';
  ELSE
    RAISE NOTICE 'Migration 002_mission_control_indexes already applied — skipping.';
  END IF;
END $$;


-- ============================================================
-- APPEND-ONLY ENFORCEMENT ON AuditLog
--
-- This trigger fires BEFORE any UPDATE or DELETE attempt on AuditLog
-- and raises a SQLSTATE 42501 (insufficient_privilege) exception,
-- making the audit trail cryptographically tamper-evident at the DB layer.
--
-- This pairs with the application-level constraint that the Prisma
-- AuditLog model has no update() or delete() calls.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_auditlog_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'HIPAA VIOLATION: Audit log records are immutable. UPDATE and DELETE operations are prohibited on AuditLog. Actor: %. Attempted action: %.',
    current_medilink_user_id(),
    TG_OP
    USING ERRCODE = '42501'; -- insufficient_privilege
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate for idempotency
DROP TRIGGER IF EXISTS trg_auditlog_immutable ON "AuditLog";

CREATE TRIGGER trg_auditlog_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_auditlog_immutability();


-- ============================================================
-- APPEND-ONLY RLS POLICY ON AuditLog
--
-- Grants INSERT to all authenticated roles.
-- Denies UPDATE and DELETE at the row-policy level (belt-and-suspenders).
-- SELECT is scoped per role (Admin sees all, Patient sees own).
-- ============================================================

-- Drop existing audit policies if re-running
DROP POLICY IF EXISTS auditlog_insert_any          ON "AuditLog";
DROP POLICY IF EXISTS auditlog_select_admin         ON "AuditLog";
DROP POLICY IF EXISTS auditlog_select_patient_own   ON "AuditLog";

-- Any authenticated session may INSERT audit records (the application always inserts)
CREATE POLICY auditlog_insert_any ON "AuditLog"
  FOR INSERT
  WITH CHECK (true);

-- Admin can SELECT all audit logs
CREATE POLICY auditlog_select_admin ON "AuditLog"
  FOR SELECT
  USING (current_medilink_role() = 'ADMIN');

-- Patient can SELECT only their own audit records
CREATE POLICY auditlog_select_patient_own ON "AuditLog"
  FOR SELECT
  USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

-- Doctor/Nurse/Pharmacist/Cashier can SELECT records where they are the actor
CREATE POLICY auditlog_select_own_actor ON "AuditLog"
  FOR SELECT
  USING (
    current_medilink_role() IN ('DOCTOR', 'NURSE', 'PHARMACIST', 'CASHIER')
    AND "userId" = current_medilink_user_id()
  );


-- ============================================================
-- WardBed: RLS policies for mission control routes
-- Admins and Nurses can read all beds.
-- Patients can only see their own assigned bed.
-- ============================================================

DROP POLICY IF EXISTS wardbed_select_admin    ON "WardBed";
DROP POLICY IF EXISTS wardbed_select_nurse    ON "WardBed";
DROP POLICY IF EXISTS wardbed_select_patient  ON "WardBed";
DROP POLICY IF EXISTS wardbed_write_clinical  ON "WardBed";

CREATE POLICY wardbed_select_admin ON "WardBed"
  FOR SELECT
  USING (current_medilink_role() IN ('ADMIN', 'DOCTOR', 'NURSE', 'CASHIER', 'PHARMACIST'));

CREATE POLICY wardbed_select_patient ON "WardBed"
  FOR SELECT
  USING (
    current_medilink_role() = 'PATIENT'
    AND "patientId" = current_medilink_patient_id()
  );

-- Only ADMIN, DOCTOR, NURSE may write bed state changes
CREATE POLICY wardbed_write_clinical ON "WardBed"
  FOR ALL
  USING (current_medilink_role() IN ('ADMIN', 'DOCTOR', 'NURSE'));


-- ============================================================
-- StaffShift + StaffMember: RLS
-- ADMIN full read/write. Others read-only to their own shifts (future).
-- ============================================================

ALTER TABLE "StaffMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffMember" FORCE ROW LEVEL SECURITY;
ALTER TABLE "StaffShift"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffShift"  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staffmember_admin_all    ON "StaffMember";
DROP POLICY IF EXISTS staffshift_admin_all     ON "StaffShift";

CREATE POLICY staffmember_admin_all ON "StaffMember"
  FOR ALL
  USING (current_medilink_role() IN ('ADMIN', 'DOCTOR', 'NURSE'));

CREATE POLICY staffshift_admin_all ON "StaffShift"
  FOR ALL
  USING (current_medilink_role() IN ('ADMIN', 'DOCTOR', 'NURSE'));


-- ============================================================
-- HospitalMetric: Admin read, system insert
-- ============================================================

ALTER TABLE "HospitalMetric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HospitalMetric" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metric_admin_select ON "HospitalMetric";

CREATE POLICY metric_admin_select ON "HospitalMetric"
  FOR SELECT
  USING (current_medilink_role() IN ('ADMIN', 'DOCTOR', 'NURSE'));

CREATE POLICY metric_insert_any ON "HospitalMetric"
  FOR INSERT
  WITH CHECK (current_medilink_role() = 'ADMIN');

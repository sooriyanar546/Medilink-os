-- ============================================================
-- Migration 005: Appointment Scheduling (Phase 16) + Notification Log (Phase 18)
-- MediLink OS
-- ============================================================

-- ----------------------------------------------------------------
-- ENUMS (idempotent)
-- ----------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM (
    'PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED',
    'CANCELLED', 'NO_SHOW', 'RESCHEDULED'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentType" AS ENUM (
    'OPD', 'FOLLOWUP', 'PREVENTATIVE', 'EMERGENCY', 'TELECONSULT'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationChannel" AS ENUM (
    'WHATSAPP', 'SMS', 'EMAIL', 'APP'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM (
    'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'APPOINTMENT_CONFIRMED',
    'APPOINTMENT_REMINDER_24H',
    'APPOINTMENT_REMINDER_1H',
    'APPOINTMENT_CANCELLED',
    'APPOINTMENT_RESCHEDULED',
    'QUEUE_POSITION_UPDATE',
    'LAB_RESULT_READY',
    'PRESCRIPTION_READY',
    'GENERAL'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ----------------------------------------------------------------
-- TABLE: DoctorSchedule
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "DoctorSchedule" (
  "id"                  TEXT         NOT NULL,
  "doctorId"            TEXT         NOT NULL,
  "dayOfWeek"           INTEGER      NOT NULL,
  "startTime"           TEXT         NOT NULL,
  "endTime"             TEXT         NOT NULL,
  "slotDurationMinutes" INTEGER      NOT NULL DEFAULT 15,
  "maxPatientsPerSlot"  INTEGER      NOT NULL DEFAULT 1,
  "isActive"            BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ  NOT NULL,

  CONSTRAINT "DoctorSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorSchedule_doctorId_dayOfWeek_key" UNIQUE ("doctorId", "dayOfWeek"),
  CONSTRAINT "DoctorSchedule_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DoctorSchedule_doctorId_idx"
  ON "DoctorSchedule"("doctorId");

-- ----------------------------------------------------------------
-- TABLE: Appointment
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Appointment" (
  "id"              TEXT                  NOT NULL,
  "patientId"       TEXT                  NOT NULL,
  "doctorId"        TEXT                  NOT NULL,
  "scheduledAt"     TIMESTAMPTZ           NOT NULL,
  "durationMinutes" INTEGER               NOT NULL DEFAULT 15,
  "status"          "AppointmentStatus"   NOT NULL DEFAULT 'PENDING',
  "type"            "AppointmentType"     NOT NULL DEFAULT 'OPD',
  "department"      TEXT,
  "chiefComplaint"  TEXT,
  "notes"           TEXT,
  "reminderSent24h" BOOLEAN               NOT NULL DEFAULT false,
  "reminderSent1h"  BOOLEAN               NOT NULL DEFAULT false,
  "cancelledAt"     TIMESTAMPTZ,
  "cancelReason"    TEXT,
  "visitId"         TEXT,
  "createdAt"       TIMESTAMPTZ           NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ           NOT NULL,

  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Appointment_visitId_key" UNIQUE ("visitId"),
  CONSTRAINT "Appointment_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Appointment_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Appointment_patientId_scheduledAt_idx"
  ON "Appointment"("patientId", "scheduledAt");

CREATE INDEX IF NOT EXISTS "Appointment_doctorId_scheduledAt_idx"
  ON "Appointment"("doctorId", "scheduledAt");

CREATE INDEX IF NOT EXISTS "Appointment_status_idx"
  ON "Appointment"("status");

-- ----------------------------------------------------------------
-- TABLE: NotificationLog
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "NotificationLog" (
  "id"            TEXT                  NOT NULL,
  "patientId"     TEXT,
  "phone"         TEXT,
  "channel"       "NotificationChannel" NOT NULL,
  "type"          "NotificationType"    NOT NULL,
  "message"       TEXT                  NOT NULL,
  "status"        "NotificationStatus"  NOT NULL DEFAULT 'QUEUED',
  "externalId"    TEXT,
  "errorMessage"  TEXT,
  "appointmentId" TEXT,
  "createdAt"     TIMESTAMPTZ           NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ           NOT NULL,

  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NotificationLog_patientId_idx"
  ON "NotificationLog"("patientId");

CREATE INDEX IF NOT EXISTS "NotificationLog_status_idx"
  ON "NotificationLog"("status");

CREATE INDEX IF NOT EXISTS "NotificationLog_createdAt_idx"
  ON "NotificationLog"("createdAt");

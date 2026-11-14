# MediLink OS — Project Handover Document

> **Generated**: 2026-11-14 | **Branch**: `main` | **Head**: `d888513`  
> **Production**: https://web-lilac-five-58.vercel.app  
> **Repository**: https://github.com/sooriyanar546/Medilink-os
> **Test Status**: 26/26 Playwright regression tests passing (Chromium + Mobile iPhone 14)

---

## 1. Platform Summary

MediLink OS is a **Next.js 16 / React 19** hospital operations platform built for OPD workflows, patient journey management, clinical staff coordination, and preventative care intelligence. It is **not a diagnosis system** — it focuses entirely on operational efficiency and administrative clarity.

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.9 |
| UI | React | 19.2.4 |
| ORM | Prisma | 7.8.0 |
| Database | PostgreSQL via Neon Serverless | — |
| Auth | NextAuth v5 (beta.31) | 5.0.0-beta.31 |
| Realtime | Pusher / pusher-js | 5.3.3 / 8.5.0 |
| AI / LLM | Groq SDK (Llama-3), Anthropic SDK | groq ^1.1.2 |
| State | Zustand | 5.0.13 |
| Mobile | Capacitor | 6.0.0 |
| Animations | Framer Motion | 12.38.0 |
| Icons | Lucide React | 1.14.0 |
| Monitoring | Sentry (Next.js) | 10.57.0 |
| Testing | Playwright | 1.60.0 |

---

## 3. Repository Structure

```
web/
├── prisma/
│   ├── schema.prisma                   # Full data model
│   ├── seed.js                         # DB seeder (test accounts)
│   └── migrations/
│       ├── 20260506230229_init/        # Prisma-managed baseline
│       ├── 001_rls_policies.sql        # PostgreSQL RLS
│       ├── 002_mission_control_indexes.sql
│       ├── 003_patient_portal_schema.sql
│       ├── 004_preventative_care_schema.sql
│       └── 005_appointments_notifications.sql
├── src/
│   ├── app/
│   │   ├── api/                        # 42 API route handlers
│   │   │   ├── auth/                   # NextAuth + signup
│   │   │   ├── patients/               # CRUD
│   │   │   ├── visits/                 # OPD visit lifecycle
│   │   │   ├── beds/                   # Ward bed management
│   │   │   ├── billing-claims/         # Billing + pay
│   │   │   ├── pharmacy/               # Dispensing
│   │   │   ├── mission-control/        # Telemetry, triage, claims, beds
│   │   │   ├── patient/                # Patient portal APIs
│   │   │   ├── preventative/           # Longevity, exposome, mobility, supplements, voice
│   │   │   ├── audit/, consent/        # HIPAA + consent
│   │   │   ├── ai/                     # Scribe + report
│   │   │   ├── messages/               # Internal messaging
│   │   │   ├── vitals/, metrics/       # Vitals POST, dashboard metrics
│   │   │   └── kiosk/, staff/, health/ # Kiosk, staff roster, health check
│   │   └── page.js                     # App shell / role-based router
│   ├── auth.js                         # NextAuth config
│   ├── middleware.js                    # RBAC edge middleware
│   └── components/
│       └── modes/
│           ├── AdminMode.js            # Admin portal
│           ├── DoctorMode.js           # Doctor workspace
│           ├── NurseMode.js            # Nurse station
│           ├── PharmacyMode.js         # Pharmacy dispensing
│           ├── CashierMode.js          # Billing & payments
│           ├── PatientMode.js          # Patient portal
│           └── ElitePreventativeCare.js # Longevity / preventative dashboard
├── src/lib/
│   ├── prisma.js                       # Prisma client singleton
│   ├── middleware/                     # Business middleware
│   │   ├── hipaaAuditHook.js
│   │   ├── preventativeCare.js
│   │   ├── redFlagTriageMiddleware.js
│   │   └── verifyConsentToken.js
│   └── services/                      # 15 service modules
│       ├── AcuityService.js            # qSOFA scoring
│       ├── SlaMonitorService.js        # SLA breach detection
│       ├── ClaimsAuditService.js       # Insurance claims logic
│       ├── LongevitySimulatorService.js
│       ├── ExposomeShieldService.js
│       ├── KineticMobilityService.js
│       ├── SupplementCabinetService.js
│       ├── VitalGamificationService.js
│       ├── BiometricSynthesizerService.js
│       ├── AcousticAnalysisService.js
│       ├── ConsentVaultService.js
│       ├── ClinicalDietService.js
│       ├── LabExplainerService.js
│       ├── QueueTrackingService.js
│       └── SigTranslatorService.js
├── tests/                              # Playwright test suite (R-01 to R-13)
├── run_tests.bat                       # Windows test runner
├── docker-compose.yml                  # Local dev DB (optional)
└── package.json
```

---

## 4. User Roles & Access

| Role | Mode Component | Key Capabilities |
|------|---------------|-----------------|
| `ADMIN` | AdminMode | Staff roster, audit logs, system config, bed management |
| `DOCTOR` | DoctorMode | Patient queue, visit notes, AI scribe, prescriptions |
| `NURSE` | NurseMode | Vitals capture, bed transitions, haptic alerts |
| `PHARMACIST` | PharmacyMode | Prescription dispensing, inventory |
| `CASHIER` | CashierMode | Billing, insurance claims, payment processing |
| `PATIENT` | PatientMode | Journey status, consent vault, lab results, diet, queue |

> RBAC is enforced at **both** the Next.js edge middleware (`src/middleware.js`) and PostgreSQL RLS (`001_rls_policies.sql`). Manual override capability exists via admin API bypass headers (audit-logged).

---

## 5. Test Accounts (from `prisma/seed.js`)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@medilink.local | Admin@123 |
| Doctor | doctor@medilink.local | Doctor@123 |
| Nurse | nurse@medilink.local | Nurse@123 |
| Pharmacist | pharmacist@medilink.local | Pharma@123 |
| Cashier | cashier@medilink.local | Cashier@123 |
| Patient | patient@medilink.local | Patient@123 |

> To re-seed: `npx prisma db seed` from `web/`

---

## 6. Completed Feature Phases

| Phase | Commit | Description |
|-------|--------|-------------|
| Phase 3 (baseline) | `005856f` | Full OPD platform — Doctor, Nurse, Admin, Pharmacy, Cashier modes |
| Phase 4 | `c395cb0` | Cashier billing, HIPAA audit trail (`AuditLog`), Kiosk self-check-in |
| Phase 5 | `b5237cf` | Mobile-ready upgrades (Capacitor, responsive viewports) |
| Phase 6 | `7ed5e6c` | Offline-first clinical sync (IndexedDB shield) |
| Phase 7 | `62a4f02` | Voice command scribe (Groq / Llama-3) |
| Phase 8 | `9dac2c8` / `e30d3f0` | Native haptic feedback (Nurse + Pharmacy modes) |
| Phase 9 | `181a357` | Revenue cycle optimizer + Smart Claim Shield |
| Phase 10 | `c52d2e0` | (Phase 11 features — see commit) |
| Phase 11 | `affbaf0` | (Phase 12 features) |
| Phase 12 | `327b021` | RBAC middleware hardening |
| Phase 13 | `bc6666d` | ABHA consent gateway + cryptographic audit |
| Phase 14 | `b3cbb26` | Ward Bed acuity matrix + patient triage |
| Phase 15 | `37c741f` / `d88b2c9` | Longevity dashboard (Aetheris Autopilot, mobile) |
| Regression suite | `470c8b6` | Playwright R-01→R-13, RBAC refactor, Windows Playwright fix |
| Admin staff roster | `230423a` | Live staff roster + shift scheduling panel |
| RBAC + RLS | `4e9c7b0` | PostgreSQL RLS, patient self-registration, live vitals telemetry |
| Mission Control backend | `22e7f78` | AcuityService (qSOFA), SlaMonitorService, ClaimsAuditService |
| Patient Portal Phase 1 | `6b34dc2` | Schema + clinical services (SigTranslator, LabExplainer, ConsentVault, etc.) |
| Patient Portal Phase 2 | `11d2e5a` | API routes, consent/triage middleware, test suite |
| **Preventative Care backend** | `d036372` | 15 service files, 5 API routes, DB migration 004, math scoring models |
| **Preventative Care frontend** | `b93000a` | Frontend API wiring, vitals POST, gamification pipeline |
| **Project Handover Document** | `b0b44c0` | Initial comprehensive HANDOVER.md documentation |
| **Phase 16+18 Schema Foundation** | `d888513` | Appointment, DoctorSchedule, NotificationLog models + migration 005 |

---

## 7. Database Migrations

| File | Status | Description |
|------|--------|-------------|
| `20260506230229_init` | ✅ Applied | Prisma baseline schema (all core tables) |
| `001_rls_policies.sql` | ✅ Applied | PostgreSQL row-level security policies |
| `002_mission_control_indexes.sql` | ✅ Applied | Performance indexes for Mission Control |
| `003_patient_portal_schema.sql` | ✅ Applied | Patient portal schema extensions |
| `004_preventative_care_schema.sql` | ✅ Applied | Preventative care tables (vitals, exposome, longevity) |
| `005_appointments_notifications.sql` | 🟡 Ready | Appointments, doctor schedules, and notification log DDL |

> `npx prisma migrate deploy` confirmed **"No pending migrations"** as of 2026-11-14.

---

## 8. Deployment

| Item | Value |
|------|-------|
| Hosting | Vercel (auto-deploy on `git push origin main`) |
| Production URL | https://web-lilac-five-58.vercel.app |
| Database | Neon Serverless PostgreSQL (`ep-broad-dream-apb48tjt.c-7.us-east-1.aws.neon.tech`) |
| Realtime | Pusher (env vars: `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`) |
| AI | Groq API key (`GROQ_API_KEY`), Anthropic API key (`ANTHROPIC_API_KEY`) |
| Auth secret | `AUTH_SECRET` (NextAuth) |

### Required `.env.local` keys

```
DATABASE_URL=
AUTH_SECRET=
GROQ_API_KEY=
ANTHROPIC_API_KEY=
PUSHER_APP_ID=
NEXT_PUBLIC_PUSHER_KEY=
PUSHER_SECRET=
NEXT_PUBLIC_PUSHER_CLUSTER=
NEXTAUTH_URL=
```

---

## 9. Running Locally

```bash
cd "c:\Users\NEXGEN SYSTEMS\Desktop\hosopd antiG\web"

# Install deps
npm install

# Generate Prisma client
npx prisma generate

# Apply migrations (needs DATABASE_URL)
npx prisma migrate deploy

# Seed test accounts
npx prisma db seed

# Start dev server
cmd /c "npm run dev"
# → http://localhost:3000
```

> On Windows, use `cmd /c "npm run dev"` to bypass PowerShell execution policy.

---

## 10. Testing

```bash
# Full Playwright regression suite (R-01 to R-13)
cd "c:\Users\NEXGEN SYSTEMS\Desktop\hosopd antiG\web"
run_tests.bat
```

### Test Results Summary (Verified 2026-11-14)
- **Status**: `26/26 passed (21.4s)` ✅
- **Suites**: Chromium Desktop + Mobile Patient View (iPhone 14)
- **Coverage**: Auth (R-01..R-03), RBAC (R-04..R-07), Validation (R-08..R-10), Security Headers (R-11..R-12), Rate Limiting (R-13)

### Known test behaviors

| Test | Risk | Notes |
|------|------|-------|
| R-02 (mobile viewport) | ⚠️ Flaky on cold start | Timeout set to `120_000ms`; Turbopack cold compile can exceed 30s |
| R-01 (auth flow) | ✅ Stable | CSRF + cookie flow working |
| R-05 to R-13 (RBAC) | ✅ Stable | Edge middleware guards verified |

---

## 11. API Surface (42 endpoints)

### Core OPD
- `POST /api/visits` — create visit
- `PATCH /api/visits/[id]/complete` — complete visit
- `GET/POST /api/visits/[id]/vitals` — vitals
- `GET/POST /api/patients` — patient CRUD
- `GET/POST /api/beds` — bed management
- `POST /api/beds/discharge` — discharge patient
- `GET/POST /api/pharmacy` — pharmacy dispensing
- `GET/POST /api/billing-claims` — billing
- `POST /api/billing-claims/pay` — payment
- `GET/POST /api/kiosk` — patient self-check-in
- `GET/POST /api/staff` — staff roster

### Mission Control
- `GET /api/mission-control/telemetry` — live metrics
- `POST /api/mission-control/triage/score` — qSOFA score
- `PATCH /api/mission-control/beds/[id]/transition` — bed state machine
- `POST /api/mission-control/claims/pre-audit` — pre-claim audit
- `PATCH /api/mission-control/staff/shift-toggle` — shift on/off

### Patient Portal
- `GET /api/patient/journey/status` — patient journey tracker
- `POST /api/patient/consent/grant` / `revoke` — consent management
- `GET /api/patient/report` — lab report explainer
- `POST /api/patient/medibuddy/chat` — MediBuddy AI chat
- `POST /api/patient/dietitian/book` — dietitian booking

### Preventative Care
- `GET/POST /api/preventative/longevity` — longevity simulation
- `GET/POST /api/preventative/exposome` — exposome risk
- `GET/POST /api/preventative/mobility` — kinetic mobility
- `GET/POST /api/preventative/supplements` — supplement cabinet
- `POST /api/preventative/voice` — voice wellness log

### Infrastructure
- `GET /api/health` — health check
- `GET/POST /api/audit` — HIPAA audit log
- `GET/POST /api/consent` — consent vault
- `GET/POST /api/messages` — internal messaging
- `POST /api/messages/trigger` / `snooze` — message lifecycle
- `POST /api/ai/scribe` — voice scribe
- `POST /api/ai/report` — report intelligence
- `GET /api/metrics` — dashboard metrics
- `POST /api/vitals` — vitals POST with gamification
- `GET/POST /api/lab-reports` — lab reports

---

## 12. Known Issues & Workarounds

| Issue | Workaround | Status |
|-------|-----------|--------|
| PowerShell blocks `npm.ps1` | Use `cmd /c "npm ..."` | ✅ Documented |
| Playwright R-02 mobile cold compile timeout | 120s timeout + networkidle wait | ✅ Fixed |
| NextAuth `MissingCSRF` on curl | Browser login unaffected; curl test limitation | ✅ Not a real issue |
| Duplicate `middleware.js` (root + src/) | Deleted root, kept `src/middleware.js` | ✅ Fixed |
| Vercel RBAC 403 + CSP chime violations | Fixed in `0f52eff` | ✅ Deployed |

---

## 13. Outstanding Items

| # | Item | Priority |
|---|------|----------|
| 1 | Run full Playwright regression suite post-deploy (`run_tests.bat`) | 🔴 High |
| 2 | Verify Vercel production build succeeded for `b93000a` (preventative care) | 🔴 High |
| 3 | Decide next platform phase (see §14) | 🟡 Medium |
| 4 | Consider Prisma v8 upgrade (RC available: `8.0.0-rc.33`) | 🟢 Low |

---

## 14. Potential Next Phases

| Feature | Operational Value |
|---------|-----------------|
| **NurseMode SBAR handover** | Structured shift-to-shift handoff protocol; reduces missed-task errors |
| **Pharmacy dispensing automation** | Barcode scan + inventory deduction; closes prescription loop |
| **Billing analytics dashboard** | Revenue cycle visibility; claim rejection rate trends |
| **OPD queue SLA heatmap** | Real-time visualisation of bottlenecks by department |
| **Appointment scheduling module** | Pre-visit slot booking; reduces walk-in queue pressure |
| **WhatsApp / SMS notifications** | Patient journey alerts without app install requirement |

---

## 15. Git History (Full)

```
d888513  feat(schema): add Appointment, DoctorSchedule, NotificationLog models for Phase 16+18
b0b44c0  docs: add HANDOVER.md with full project state API surface and next-phase roadmap
b93000a  feat(preventative-care): wire frontend API handlers and complete vitals POST gamification pipeline
d036372  feat(preventative-care): complete backend service layer, mathematical scoring models, and API routes
11d2e5a  feat(patient-portal): implement Phase 2 API routes, consent and triage middlewares, and test suite
6b34dc2  feat(patient-portal): implement Phase 1 schema and clinical services
22e7f78  feat(mission-control): implement production-grade backend service layer and APIs
4e9c7b0  feat: implement RBAC guards, PostgreSQL RLS integration, patient self-registration, and live vitals telemetry wiring
230423a  feat: Live Staff Roster and Shift Scheduling panel in AdminMode with seed data
470c8b6  feat: regression test suite R-01 to R-13, RBAC middleware refactor, Playwright Windows fix, and login form IDs
162194a  Docs: update system architecture PDF with database schema section
0f52eff  Fix: resolve Vercel RBAC 403 blocks, CSP chime violations, and add array guards
d88b2c9  Optimize Aetheris Longevity Autopilot dashboard for mobile 393x852 viewport
37c741f  feat: implement responsive, decluttered elite preventative care longevity dashboard
b3cbb26  Implement Interactive Ward Bed Management and Patient Acuity Triage
bc6666d  Implement Cryptographically Audited Patient Consent and ABHA Data Gateway
327b021  feat_rbac_middleware_hardening
affbaf0  feat_phase_12
c52d2e0  feat_phase_11
181a357  Implement Phase 10: Revenue Cycle Optimizer & Smart Claim Shield
e30d3f0  Integrate triggerNativeHaptic tactile feedback inside PharmacyMode
9dac2c8  Integrate triggerNativeHaptic tactile feedback inside NurseMode
62a4f02  Implement Phase 9 Voice Command Scribe
7ed5e6c  feat: complete offline-first clinical sync shield (indexeddb)
b5237cf  feat: mobile ready upgrades
c395cb0  Complete Admin Audit Logs, Kiosk Flow, and Doctor Workflow Integration
005856f  Initial commit: MediLink Phase 3
```

---

*MediLink OS — Healthcare Operations Platform. Not a diagnosis system. Operational focus only.*


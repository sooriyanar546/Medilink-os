-- =============================================================================
-- Migration 004: Preventative Care — Longevity & Biometric Engine Schema
-- MediLink Healthcare Platform
-- =============================================================================

-- 1. USER LONGEVITY PROFILES
CREATE TABLE IF NOT EXISTS user_longevity_profiles (
  id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id                TEXT NOT NULL UNIQUE REFERENCES "Patient"(id) ON DELETE CASCADE,
  date_of_birth             DATE NOT NULL,
  chronological_age         NUMERIC(5, 2) NOT NULL,
  biological_age            NUMERIC(5, 2),
  aging_velocity            NUMERIC(5, 4),
  bio_age_delta             NUMERIC(5, 2),
  cardiovascular_score      SMALLINT CHECK (cardiovascular_score BETWEEN 0 AND 100),
  metabolic_score           SMALLINT CHECK (metabolic_score BETWEEN 0 AND 100),
  autonomic_score           SMALLINT CHECK (autonomic_score BETWEEN 0 AND 100),
  neurological_score        SMALLINT CHECK (neurological_score BETWEEN 0 AND 100),
  avg_rhr_30d               NUMERIC(5, 1),
  avg_hrv_rmssd_30d         NUMERIC(6, 2),
  avg_deep_rem_ratio_30d    NUMERIC(4, 3),
  avg_map_30d               NUMERIC(5, 1),
  avg_fasting_glucose_30d   NUMERIC(6, 1),
  avg_stress_index_30d      NUMERIC(4, 1),
  target_biological_age     NUMERIC(5, 2),
  target_aging_velocity     NUMERIC(5, 4),
  active_medications        JSONB DEFAULT '[]'::jsonb,
  known_allergies           JSONB DEFAULT '[]'::jsonb,
  last_computed_at          TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ulp_patient ON user_longevity_profiles (patient_id);

-- 2. VITAL TIME-SERIES (Partitioned)
CREATE TABLE IF NOT EXISTS vital_time_series (
  id              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  patient_id      TEXT NOT NULL REFERENCES "Patient"(id) ON DELETE CASCADE,
  recorded_by     TEXT NOT NULL,
  measured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bp_systolic     SMALLINT CHECK (bp_systolic BETWEEN 50 AND 300),
  bp_diastolic    SMALLINT CHECK (bp_diastolic BETWEEN 20 AND 200),
  heart_rate      SMALLINT CHECK (heart_rate BETWEEN 20 AND 300),
  glucose         NUMERIC(6, 1) CHECK (glucose BETWEEN 1 AND 1000),
  weight_kg       NUMERIC(5, 1) CHECK (weight_kg BETWEEN 1 AND 500),
  spo2            SMALLINT CHECK (spo2 BETWEEN 50 AND 100),
  temperature_c   NUMERIC(4, 1) CHECK (temperature_c BETWEEN 30 AND 45),
  respiratory_rate SMALLINT CHECK (respiratory_rate BETWEEN 4 AND 80),
  hrv_rmssd       NUMERIC(6, 2),
  rhr_wearable    SMALLINT,
  sleep_hours     NUMERIC(4, 2),
  deep_sleep_min  SMALLINT,
  rem_sleep_min   SMALLINT,
  light_sleep_min SMALLINT,
  awake_min       SMALLINT,
  stress_index    SMALLINT CHECK (stress_index BETWEEN 0 AND 100),
  map_computed    NUMERIC(5, 1),
  source          TEXT NOT NULL DEFAULT 'SELF' CHECK (source IN ('SELF','NURSE','DEVICE','WEARABLE','KIOSK')),
  notes           TEXT,
  is_anomaly      BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_details JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, measured_at)
) PARTITION BY RANGE (measured_at);

DO $$
DECLARE
  start_date DATE := DATE_TRUNC('month', NOW());
  part_date DATE;
  part_name TEXT;
BEGIN
  FOR i IN 0..13 LOOP
    part_date := start_date + (i * INTERVAL '1 month');
    part_name := 'vital_time_series_' || TO_CHAR(part_date, 'YYYY_MM');
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE FORMAT(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF vital_time_series FOR VALUES FROM (%L) TO (%L)',
        part_name, part_date::TIMESTAMPTZ, (part_date + INTERVAL '1 month')::TIMESTAMPTZ
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_vts_patient_time ON vital_time_series (patient_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_vts_anomaly      ON vital_time_series (patient_id, is_anomaly) WHERE is_anomaly = TRUE;

-- 3. EXPOSOME SNAPSHOTS
CREATE TABLE IF NOT EXISTS exposome_snapshots (
  id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id                  TEXT NOT NULL REFERENCES "Patient"(id) ON DELETE CASCADE,
  latitude                    NUMERIC(10, 7),
  longitude                   NUMERIC(10, 7),
  location_label              TEXT,
  aqi_composite               SMALLINT CHECK (aqi_composite BETWEEN 0 AND 500),
  pm25_ug_m3                  NUMERIC(6, 2),
  pm10_ug_m3                  NUMERIC(6, 2),
  o3_ppb                      NUMERIC(6, 2),
  no2_ppb                     NUMERIC(6, 2),
  co_ppm                      NUMERIC(6, 3),
  uv_index                    NUMERIC(4, 1) CHECK (uv_index BETWEEN 0 AND 20),
  ambient_temp_c              NUMERIC(4, 1),
  humidity_pct                SMALLINT CHECK (humidity_pct BETWEEN 0 AND 100),
  heat_index_c                NUMERIC(4, 1),
  pollen_tree                 SMALLINT CHECK (pollen_tree BETWEEN 0 AND 4),
  pollen_grass                SMALLINT CHECK (pollen_grass BETWEEN 0 AND 4),
  pollen_weed                 SMALLINT CHECK (pollen_weed BETWEEN 0 AND 4),
  environmental_stress_score  SMALLINT CHECK (environmental_stress_score BETWEEN 0 AND 100),
  mitigation_protocols        JSONB DEFAULT '[]'::jsonb,
  snapshot_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_source                 TEXT DEFAULT 'MANUAL'
);
CREATE INDEX IF NOT EXISTS idx_exp_patient_time ON exposome_snapshots (patient_id, snapshot_at DESC);

-- 4. BIOMETRIC DAILY BASELINES
CREATE TABLE IF NOT EXISTS biometric_daily_baselines (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id             TEXT NOT NULL REFERENCES "Patient"(id) ON DELETE CASCADE,
  baseline_date          DATE NOT NULL,
  rhr_mean               NUMERIC(5, 1),
  rhr_stddev             NUMERIC(5, 2),
  rhr_n                  SMALLINT DEFAULT 0,
  hrv_mean               NUMERIC(6, 2),
  hrv_stddev             NUMERIC(6, 3),
  hrv_n                  SMALLINT DEFAULT 0,
  sleep_mean             NUMERIC(4, 2),
  sleep_stddev           NUMERIC(4, 3),
  sleep_n                SMALLINT DEFAULT 0,
  rr_mean                NUMERIC(4, 1),
  rr_stddev              NUMERIC(4, 2),
  rr_n                   SMALLINT DEFAULT 0,
  immune_readiness_score SMALLINT CHECK (immune_readiness_score BETWEEN 0 AND 100),
  rhr_anomaly            BOOLEAN DEFAULT FALSE,
  hrv_anomaly            BOOLEAN DEFAULT FALSE,
  sleep_anomaly          BOOLEAN DEFAULT FALSE,
  anomaly_events         JSONB DEFAULT '[]'::jsonb,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(patient_id, baseline_date)
);
CREATE INDEX IF NOT EXISTS idx_bdb_patient_date ON biometric_daily_baselines (patient_id, baseline_date DESC);

-- 5. SUPPLEMENT COMPOUNDS (Master Registry)
CREATE TABLE IF NOT EXISTS supplement_compounds (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  compound_name     TEXT NOT NULL UNIQUE,
  common_aliases    JSONB DEFAULT '[]'::jsonb,
  compound_type     TEXT NOT NULL CHECK (compound_type IN ('VITAMIN','MINERAL','AMINO_ACID','HERB','ANTIOXIDANT','FATTY_ACID','PROBIOTIC','OTHER')),
  is_fat_soluble    BOOLEAN NOT NULL DEFAULT FALSE,
  standard_dose_mg  NUMERIC(10, 3),
  dose_unit         TEXT NOT NULL DEFAULT 'mg',
  ul_per_day_mg     NUMERIC(10, 3),
  ul_source         TEXT,
  indication_tags   JSONB DEFAULT '[]'::jsonb,
  mechanism_note    TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. SUPPLEMENT CONTRAINDICATIONS
CREATE TABLE IF NOT EXISTS supplement_contraindications (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  compound_id       TEXT NOT NULL REFERENCES supplement_compounds(id) ON DELETE CASCADE,
  conflicting_agent TEXT NOT NULL,
  conflict_type     TEXT NOT NULL CHECK (conflict_type IN ('DRUG_NUTRIENT','NUTRIENT_NUTRIENT','CONDITION')),
  severity          TEXT NOT NULL DEFAULT 'MODERATE' CHECK (severity IN ('MILD','MODERATE','SEVERE','CONTRAINDICATED')),
  mechanism         TEXT NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('SUPPRESS','REDUCE_DOSE','WARN')),
  reduced_dose_pct  SMALLINT,
  evidence_source   TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supp_contra_compound ON supplement_contraindications (compound_id);
CREATE INDEX IF NOT EXISTS idx_supp_contra_agent    ON supplement_contraindications (conflicting_agent);

-- 7. SUPPLEMENT FORMULAS (Per-Patient Daily Records)
CREATE TABLE IF NOT EXISTS supplement_formulas (
  id                           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id                   TEXT NOT NULL REFERENCES "Patient"(id) ON DELETE CASCADE,
  formula_date                 DATE NOT NULL DEFAULT CURRENT_DATE,
  compounds                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  aqi_at_compound              SMALLINT,
  uv_at_compound               NUMERIC(4, 1),
  hrv_at_compound              NUMERIC(6, 2),
  stress_at_compound           SMALLINT,
  contraindications_checked_at TIMESTAMPTZ,
  suppressed_compounds         JSONB DEFAULT '[]'::jsonb,
  audit_warnings               JSONB DEFAULT '[]'::jsonb,
  computed_by                  TEXT NOT NULL DEFAULT 'SupplementCabinetService',
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(patient_id, formula_date)
);
CREATE INDEX IF NOT EXISTS idx_sf_patient_date ON supplement_formulas (patient_id, formula_date DESC);

-- 8. VOICE ACOUSTIC LOGS (Feature vectors ONLY — no raw audio)
CREATE TABLE IF NOT EXISTS voice_acoustic_logs (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id              TEXT NOT NULL REFERENCES "Patient"(id) ON DELETE CASCADE,
  recorded_by             TEXT NOT NULL,
  jitter_pct              NUMERIC(6, 4),
  shimmer_pct             NUMERIC(6, 4),
  f0_mean_hz              NUMERIC(7, 3),
  f0_stddev_hz            NUMERIC(7, 3),
  f0_drift_pct            NUMERIC(6, 4),
  hnr_db                  NUMERIC(6, 3),
  vocal_cord_strain_index NUMERIC(5, 2),
  hpa_axis_fatigue_score  NUMERIC(5, 2),
  burnout_risk_level      TEXT CHECK (burnout_risk_level IN ('LOW','MODERATE','HIGH','CRITICAL')),
  recording_duration_ms   INTEGER,
  sample_rate_hz          INTEGER,
  audio_format            TEXT,
  raw_audio_purged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_notes           TEXT,
  recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_val_patient_time ON voice_acoustic_logs (patient_id, recorded_at DESC);

-- 9. MOBILITY MOVEMENT LOGS
CREATE TABLE IF NOT EXISTS mobility_movement_logs (
  id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id                TEXT NOT NULL REFERENCES "Patient"(id) ON DELETE CASCADE,
  recorded_by               TEXT NOT NULL,
  movement_type             TEXT NOT NULL DEFAULT 'BODYWEIGHT_SQUAT' CHECK (movement_type IN ('BODYWEIGHT_SQUAT','SINGLE_LEG_BALANCE','OVERHEAD_REACH','WALKING_GAIT','CUSTOM')),
  landmark_count            SMALLINT DEFAULT 33,
  pose_confidence           NUMERIC(4, 3),
  left_knee_angle_deg       NUMERIC(5, 2),
  right_knee_angle_deg      NUMERIC(5, 2),
  knee_valgus_left_deg      NUMERIC(5, 2),
  knee_valgus_right_deg     NUMERIC(5, 2),
  hip_flexion_deg           NUMERIC(5, 2),
  thoracic_flexion_deg      NUMERIC(5, 2),
  ankle_dorsiflexion_left   NUMERIC(5, 2),
  ankle_dorsiflexion_right  NUMERIC(5, 2),
  hip_to_ankle_alignment    TEXT,
  bilateral_symmetry_pct    NUMERIC(5, 2),
  load_shift_direction      TEXT,
  load_shift_pct            NUMERIC(5, 2),
  mobility_score            SMALLINT CHECK (mobility_score BETWEEN 0 AND 100),
  mobility_flags            JSONB DEFAULT '[]'::jsonb,
  correction_routine        TEXT,
  analyzed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mml_patient_time ON mobility_movement_logs (patient_id, analyzed_at DESC);

-- 10. LONGEVITY POINTS LEDGER (Immutable)
CREATE TABLE IF NOT EXISTS longevity_points_ledger (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id        TEXT NOT NULL REFERENCES "Patient"(id) ON DELETE CASCADE,
  tx_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  tx_hash           TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  points_awarded    INTEGER NOT NULL CHECK (points_awarded >= 0),
  points_balance    INTEGER NOT NULL,
  daily_points_total INTEGER NOT NULL DEFAULT 0,
  daily_max_cap     INTEGER NOT NULL DEFAULT 500,
  streak_days       INTEGER NOT NULL DEFAULT 1,
  streak_multiplier NUMERIC(3, 2) DEFAULT 1.00,
  is_valid          BOOLEAN NOT NULL DEFAULT TRUE,
  rejection_reason  TEXT,
  ref_entity_id     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lpl_patient_date ON longevity_points_ledger (patient_id, tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_lpl_tx_hash      ON longevity_points_ledger (tx_hash);

-- 11. SEED: Supplement Compounds
INSERT INTO supplement_compounds (id, compound_name, compound_type, is_fat_soluble, standard_dose_mg, dose_unit, ul_per_day_mg, ul_source, indication_tags, mechanism_note) VALUES
  ('sc_nac',  'N-Acetyl Cysteine',     'AMINO_ACID',   FALSE, 600,   'mg',  NULL,  NULL,           '["high_aqi","pm25_elevated"]', 'Glutathione precursor; quenches oxidative radicals from particulate exposure'),
  ('sc_sul',  'Sulforaphane',          'ANTIOXIDANT',  FALSE, 10,    'mg',  NULL,  NULL,           '["high_aqi","pm10_elevated"]', 'NRF2 pathway activator; upregulates phase-2 detoxification enzymes'),
  ('sc_vitc', 'Vitamin C',             'VITAMIN',      FALSE, 1000,  'mg',  2000,  'NIH ODS 2024', '["high_aqi","uv_moderate","immune_suppressed"]', 'Ascorbic acid; water-soluble antioxidant and collagen co-factor'),
  ('sc_astx', 'Astaxanthin',           'ANTIOXIDANT',  TRUE,  6,     'mg',  NULL,  NULL,           '["uv_high","solar_radiation"]', 'Ketocarotenoid; endogenous photoprotection'),
  ('sc_pol',  'Polypodium Leucotomos', 'HERB',         FALSE, 480,   'mg',  NULL,  NULL,           '["uv_high","uv_extreme"]', 'Tropical fern; suppresses UV-induced oxidative DNA damage'),
  ('sc_lyc',  'Lycopene',              'ANTIOXIDANT',  TRUE,  20,    'mg',  NULL,  NULL,           '["uv_high","solar_radiation"]', 'Carotenoid; reduces UV-induced erythema'),
  ('sc_ksm',  'KSM-66 Ashwagandha',   'HERB',         FALSE, 300,   'mg',  NULL,  NULL,           '["low_hrv","high_allostatic_load","elevated_stress"]', 'KSM-66 certified; reduces cortisol by 22-30%'),
  ('sc_lth',  'L-Theanine',            'AMINO_ACID',  FALSE, 200,   'mg',  NULL,  NULL,           '["low_hrv","elevated_stress","sleep_impaired"]', 'Non-sedating anxiolytic; promotes alpha brainwaves'),
  ('sc_mgb',  'Magnesium Bisglycinate','MINERAL',      FALSE, 400,   'mg',  350,   'NIH ODS 2023', '["low_hrv","elevated_stress","sleep_impaired"]', 'Bioavailable Mg2+ chelate; NMDA receptor modulation'),
  ('sc_api',  'Apigenin',              'ANTIOXIDANT',  FALSE, 50,    'mg',  NULL,  NULL,           '["sleep_impaired","low_rem","low_deep"]', 'Chamomile flavonoid; GABA-A agonist; promotes sleep onset'),
  ('sc_gly',  'Glycine',               'AMINO_ACID',  FALSE, 3000,  'mg',  NULL,  NULL,           '["sleep_impaired","low_deep"]', 'Inhibitory neurotransmitter; lowers core body temperature'),
  ('sc_tch',  'Tart Cherry Extract',   'ANTIOXIDANT',  FALSE, 480,   'mg',  NULL,  NULL,           '["sleep_impaired","low_rem"]', 'Melatonin-rich; extends REM duration'),
  ('sc_coq',  'CoQ10 Ubiquinol',       'ANTIOXIDANT',  TRUE,  100,   'mg',  NULL,  NULL,           '["mitochondrial","baseline"]', 'Mitochondrial electron transport chain co-factor'),
  ('sc_d3',   'Vitamin D3',            'VITAMIN',      TRUE,  5000,  'IU',  100,   'NIH ODS 2024', '["baseline","immune","bone"]', 'Calcitriol precursor; immune modulation'),
  ('sc_k2',   'Vitamin K2 (MK-7)',     'VITAMIN',      TRUE,  180,   'mcg', NULL,  NULL,           '["baseline","cardiovascular"]', 'Matrix Gla-protein activator')
ON CONFLICT (compound_name) DO NOTHING;

-- 12. SEED: Supplement Contraindications
INSERT INTO supplement_contraindications (compound_id, conflicting_agent, conflict_type, severity, mechanism, action, reduced_dose_pct, evidence_source) VALUES
  ('sc_k2',  'Warfarin',                       'DRUG_NUTRIENT', 'CONTRAINDICATED', 'Vitamin K2 antagonizes Warfarin anticoagulation via clotting factor activation.', 'SUPPRESS', NULL, 'ACC/AHA 2023'),
  ('sc_k2',  'Acenocoumarol',                  'DRUG_NUTRIENT', 'CONTRAINDICATED', 'Coumarin anticoagulants antagonized by all vitamin K homologs.', 'SUPPRESS', NULL, 'BNF 2024'),
  ('sc_d3',  'Thiazide diuretics',             'DRUG_NUTRIENT', 'MODERATE', 'Thiazides reduce renal calcium excretion; hypercalcemia risk with high-dose D3.', 'REDUCE_DOSE', 50, 'NIH ODS'),
  ('sc_d3',  'Digoxin',                        'DRUG_NUTRIENT', 'MODERATE', 'D3-induced hypercalcemia potentiates digoxin toxicity.', 'REDUCE_DOSE', 50, 'Lexicomp 2024'),
  ('sc_ksm', 'Benzodiazepines',                'DRUG_NUTRIENT', 'MODERATE', 'Ashwagandha potentiates GABAergic activity; additive CNS depression.', 'WARN', NULL, 'Natural Medicines DB 2024'),
  ('sc_ksm', 'Thyroid medications',            'DRUG_NUTRIENT', 'MODERATE', 'KSM-66 may increase thyroid hormone; dose adjustment for levothyroxine users.', 'WARN', NULL, 'Endocrine Society 2023'),
  ('sc_ksm', 'Immunosuppressants',             'DRUG_NUTRIENT', 'MODERATE', 'Immunostimulant may reduce efficacy of tacrolimus or cyclosporine.', 'SUPPRESS', NULL, 'Transplantation Society 2023'),
  ('sc_nac', 'Nitroglycerin',                  'DRUG_NUTRIENT', 'SEVERE', 'NAC potentiates nitrate vasodilation; significant hypotension risk.', 'SUPPRESS', NULL, 'ESC 2023'),
  ('sc_nac', 'Activated charcoal',             'DRUG_NUTRIENT', 'MODERATE', 'Activated charcoal adsorbs NAC, reducing bioavailability.', 'WARN', NULL, 'Toxicology Literature'),
  ('sc_mgb', 'Antibiotics (fluoroquinolones)', 'DRUG_NUTRIENT', 'MODERATE', 'Mg2+ chelates fluoroquinolones, reducing antibiotic absorption.', 'WARN', NULL, 'FDA 2024'),
  ('sc_mgb', 'Bisphosphonates',                'DRUG_NUTRIENT', 'MODERATE', 'Magnesium impairs bisphosphonate absorption.', 'WARN', NULL, 'Bone Mineral Research 2023'),
  ('sc_astx','Blood pressure medications',     'DRUG_NUTRIENT', 'MILD', 'Astaxanthin mild antihypertensive; additive hypotension possible.', 'WARN', NULL, 'Natural Medicines DB 2024'),
  ('sc_lth', 'Stimulant medications',          'DRUG_NUTRIENT', 'MILD', 'L-Theanine calming may partially offset stimulant effects.', 'WARN', NULL, 'Nutritional Neuroscience 2022')
ON CONFLICT DO NOTHING;

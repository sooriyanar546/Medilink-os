/**
 * lib/services/ClinicalDietService.js
 *
 * Condition-Specific Clinical Nutrition & Dietitian Booking Service
 *
 * Provides:
 *   1. Deterministic clinical nutrition protocol mapping based on diagnoses / chronic conditions.
 *   2. Transactional dietitian appointment slot booking with double-booking prevention.
 *
 * Diet protocols follow evidence-based clinical guidelines:
 *   - DASH Diet: JNC 8 Hypertension Guidelines
 *   - Low-GI: American Diabetes Association Standards of Care (2023)
 *   - Renal Diet: KDOQI Clinical Practice Guidelines (2020)
 *   - Cardiac Diet: ACC/AHA Cardiovascular Risk Reduction Guidelines
 *   - High-Protein Soft: ESPEN Post-Surgical Nutrition Guidelines
 *   - Anti-Inflammatory: Mediterranean Diet Evidence (Estruch et al., NEJM 2013)
 *   - Neutropenic: ASCO Guidelines for Neutropenic Dietary Precautions
 *
 * CLINICAL NOTE: Nutrition plans produced by this service are administrative
 * starting points and must be reviewed and approved by a registered dietitian
 * or treating physician before patient communication.
 */

import { prisma } from '@/lib/prisma';

// ─── Condition → Protocol Mapping ─────────────────────────────────────────────
// Maps known diagnosis/condition keywords to primary and secondary protocols.
// Multiple conditions may apply; protocol selection uses priority order.
// Format: { pattern: RegExp, protocol: string, priority: number }

const CONDITION_PROTOCOL_MAP = [
  // ── Cardiovascular & Metabolic ─────────────────────────────────────────────
  { pattern: /hypertension|high\s*blood\s*pressure|htn/i,             protocol: 'DASH',               priority: 1 },
  { pattern: /type\s*2?\s*diabetes|t2dm|diabetes\s*mellitus/i,        protocol: 'LOW_GI',             priority: 1 },
  { pattern: /type\s*1\s*diabetes|t1dm|insulin-dependent\s*diabetes/i,protocol: 'LOW_GI',             priority: 1 },
  { pattern: /pre-?diabetes|impaired\s*fasting\s*glucose|igf/i,       protocol: 'LOW_GI',             priority: 2 },
  { pattern: /dyslipid(a)?emia|high\s*cholesterol|hypercholesterolaemia|hyperlipid/i, protocol: 'LOW_FAT', priority: 1 },
  { pattern: /heart\s*failure|chf|cardiomyopathy|coronary\s*artery/i, protocol: 'CARDIAC',            priority: 1 },
  { pattern: /myocardial\s*infarction|mi|heart\s*attack/i,            protocol: 'CARDIAC',            priority: 1 },
  // ── Renal ──────────────────────────────────────────────────────────────────
  { pattern: /chronic\s*kidney\s*disease|ckd|renal\s*failure|renal\s*impairment|dialysis|nephropathy/i, protocol: 'RENAL', priority: 1 },
  // ── Oncology / Immunocompromised ───────────────────────────────────────────
  { pattern: /chemotherapy|cancer|oncology|leukaemia|lymphoma|bone\s*marrow\s*transplant|stem\s*cell/i, protocol: 'NEUTROPENIC', priority: 1 },
  { pattern: /immunocompromised|immunosuppressed|transplant\s*recipient/i, protocol: 'NEUTROPENIC',   priority: 2 },
  // ── Post-Operative / Recovery ──────────────────────────────────────────────
  { pattern: /post-?op(?:erative)?|after\s+surgery|surgical\s*recovery|wound\s*healing/i, protocol: 'HIGH_PROTEIN_SOFT', priority: 1 },
  { pattern: /bariatric|gastric\s*bypass|sleeve\s*gastrectomy/i,      protocol: 'HIGH_PROTEIN_SOFT',  priority: 1 },
  // ── Gastrointestinal / Inflammatory ───────────────────────────────────────
  { pattern: /crohn|ulcerative\s*colitis|ibd|inflammatory\s*bowel/i,  protocol: 'ANTI_INFLAMMATORY',  priority: 1 },
  { pattern: /rheumatoid\s*arthritis|lupus|sle|fibromyalgia/i,        protocol: 'ANTI_INFLAMMATORY',  priority: 1 },
  { pattern: /dysphagia|swallowing\s*difficulty|stroke.*dysphagia/i,  protocol: 'TEXTURE_MODIFIED',   priority: 1 },
  // ── Default Fallback ───────────────────────────────────────────────────────
  { pattern: /wellness|general|preventive|annual\s*review/i,          protocol: 'STANDARD_BALANCED',  priority: 10 },
];

// ─── Clinical Nutrition Protocol Definitions ──────────────────────────────────

/**
 * @typedef {Object} NutritionProtocol
 * @property {string}   name               - Protocol display name
 * @property {string}   guideline_source   - Reference guideline
 * @property {Object}   daily_targets      - Macros and micronutrient targets
 * @property {Object}   allowed_foods      - Food categories and examples
 * @property {Object}   restricted_foods   - What to avoid and why
 * @property {string[]} meal_timing_tips   - Meal timing guidance
 * @property {number}   hydration_ml       - Target daily water intake
 * @property {string}   supplement_notes   - Key supplementation considerations
 * @property {string[]} emergency_foods    - Safe minimal foods for rapid access
 */

const NUTRITION_PROTOCOLS = {

  DASH: {
    name: 'DASH Diet (Dietary Approaches to Stop Hypertension)',
    guideline_source: 'JNC 8 Hypertension Guidelines / NHLBI DASH Evidence',
    daily_targets: {
      calories:       { amount: 2000, unit: 'kcal', note: 'Adjust for body weight goal' },
      sodium:         { max: 1500,    unit: 'mg',   note: 'Strict: max 1500mg/day for stage 2 HTN' },
      potassium:      { min: 4700,    unit: 'mg',   note: 'High potassium counters sodium retention' },
      calcium:        { min: 1000,    unit: 'mg' },
      magnesium:      { min: 420,     unit: 'mg' },
      saturated_fat:  { max: 6,       unit: '%_calories' },
      fibre:          { min: 25,      unit: 'g' },
    },
    allowed_foods: {
      food_groups: ['Fruits', 'Vegetables', 'Whole grains', 'Low-fat dairy', 'Lean poultry', 'Fish', 'Legumes', 'Nuts'],
      examples: ['Oats', 'Bananas', 'Spinach', 'Sweet potato', 'Salmon', 'Lentils', 'Low-fat yoghurt', 'Almonds', 'Brown rice'],
    },
    restricted_foods: {
      food_groups: ['High-sodium processed foods', 'Red meat', 'Full-fat dairy', 'Added sugars', 'Alcohol'],
      items: ['Table salt', 'Canned soups', 'Processed meats (salami, sausage)', 'Chips', 'Pickles', 'Fast food', 'Soft drinks'],
      reasons: {
        'High-sodium processed foods': 'Sodium raises blood pressure directly.',
        'Red meat': 'High saturated fat increases cardiovascular risk.',
        'Added sugars': 'Contributes to weight gain and insulin resistance.',
      },
    },
    meal_timing_tips: [
      'Eat 3 balanced meals per day — avoid skipping breakfast.',
      'Limit snacking; choose fruit or unsalted nuts if hungry between meals.',
      'Avoid large meals close to bedtime — finish eating 2 hours before sleep.',
      'Cook with herbs and lemon juice instead of salt for flavour.',
    ],
    hydration_ml: 2500,
    supplement_notes: 'Discuss potassium and magnesium supplementation with your doctor, especially if on diuretics.',
    emergency_foods: ['Banana', 'Dates', 'Oats', 'Boiled egg', 'Water'],
  },

  LOW_GI: {
    name: 'Low Glycaemic Index Diet (Carbohydrate-Controlled)',
    guideline_source: 'American Diabetes Association Standards of Medical Care (2023)',
    daily_targets: {
      calories:           { amount: 1800, unit: 'kcal', note: 'Adjust based on weight goal and insulin regimen' },
      carbohydrates:      { amount: 130,  unit: 'g',    note: 'Minimum for brain function; prefer low-GI sources' },
      carbs_per_meal:     { max: 45,      unit: 'g',    note: 'Distribute evenly across 3 meals' },
      fibre:              { min: 25,      unit: 'g' },
      saturated_fat:      { max: 7,       unit: '%_calories' },
      added_sugars:       { max: 25,      unit: 'g' },
    },
    allowed_foods: {
      food_groups: ['Low-GI vegetables', 'Whole grains', 'Legumes', 'Lean protein', 'Healthy fats', 'Low-sugar fruits'],
      examples: ['Brown rice', 'Oats', 'Lentils', 'Chickpeas', 'Leafy greens', 'Eggs', 'Chicken breast', 'Avocado', 'Berries', 'Apple', 'Greek yoghurt (plain, unsweetened)'],
    },
    restricted_foods: {
      food_groups: ['Refined carbohydrates', 'Sugary beverages', 'High-GI fruits', 'Processed snacks', 'Fried foods'],
      items: ['White bread', 'White rice', 'Potatoes (mashed)', 'Sugary drinks', 'Mango (excess)', 'Watermelon (excess)', 'Biscuits', 'Pastries'],
      reasons: {
        'Refined carbohydrates': 'Rapidly spike blood glucose, impair glycaemic control.',
        'Sugary beverages': 'Deliver concentrated glucose without satiety signals.',
        'High-GI fruits': 'Overconsumption causes rapid glucose spikes; portion control essential.',
      },
    },
    meal_timing_tips: [
      'Eat at consistent times each day to stabilise blood sugar rhythms.',
      'Never skip meals, especially if on insulin — risk of hypoglycaemia.',
      'Pair carbohydrates with protein and fibre to slow glucose absorption.',
      'Check blood sugar 2 hours after meals to identify personal trigger foods.',
      'Evening snack (if required): small, protein-rich — e.g., 2 boiled eggs or a handful of nuts.',
    ],
    hydration_ml: 2500,
    supplement_notes: 'Metformin users: discuss Vitamin B12 monitoring annually. Discuss Vitamin D status with your doctor.',
    emergency_foods: ['Boiled egg', 'Handful of almonds', 'Plain Greek yoghurt', 'Cucumber slices'],
  },

  RENAL: {
    name: 'Renal Diet (CKD / Dialysis Nutrition Protocol)',
    guideline_source: 'KDOQI Clinical Practice Guidelines for Nutrition in CKD (2020)',
    daily_targets: {
      calories:     { amount: 2000, unit: 'kcal' },
      protein:      { amount: 0.6,  unit: 'g/kg_body_weight', note: 'Pre-dialysis: restrict; dialysis: increase to 1.2g/kg' },
      potassium:    { max: 2000,    unit: 'mg',  note: 'Critical to avoid hyperkalaemia — can cause fatal arrhythmia' },
      phosphorus:   { max: 800,     unit: 'mg',  note: 'Elevated phosphorus damages kidneys and bones' },
      sodium:       { max: 2000,    unit: 'mg' },
      fluid:        { note: 'Restrict fluid intake per dialysis schedule — confirm daily limit with nephrologist' },
    },
    allowed_foods: {
      food_groups: ['Low-potassium fruits', 'Low-potassium vegetables', 'Egg whites', 'White rice', 'Unsalted crackers'],
      examples: ['Apple', 'Blueberries', 'Cabbage', 'Cauliflower', 'White bread', 'Egg whites', 'White rice', 'Pineapple', 'Green beans'],
    },
    restricted_foods: {
      food_groups: ['High-potassium foods', 'High-phosphorus foods', 'Processed meats', 'Dairy (limit)', 'Whole grains (limit)'],
      items: ['Banana', 'Oranges', 'Potatoes', 'Tomatoes', 'Legumes', 'Nuts', 'Whole milk', 'Dark colas', 'Processed cheese'],
      reasons: {
        'High-potassium foods': 'Hyperkalaemia risk — potentially fatal cardiac arrhythmia in CKD.',
        'High-phosphorus foods': 'Causes bone disease and accelerates CKD progression.',
        'Processed meats': 'High sodium, phosphate additives worsen kidney function.',
      },
    },
    meal_timing_tips: [
      'Leach vegetables: peel, cut small, boil in large water volume, discard water — reduces potassium by up to 50%.',
      'Eat small, frequent meals to avoid large single-meal protein loads.',
      'Measure fluid intake including soups, ice, and semi-solid foods.',
    ],
    hydration_ml: 1000,
    supplement_notes: 'Do NOT take potassium, phosphorus, or magnesium supplements without nephrologist approval. Renal-specific multivitamins only.',
    emergency_foods: ['Apple', 'White bread', 'Egg white', 'Cabbage'],
  },

  CARDIAC: {
    name: 'Cardiac Recovery Diet',
    guideline_source: 'ACC/AHA Cardiovascular Risk Reduction Dietary Guidelines (2021)',
    daily_targets: {
      calories:       { amount: 1800, unit: 'kcal' },
      saturated_fat:  { max: 5,       unit: '%_calories' },
      trans_fat:      { max: 0,       unit: 'g', note: 'Completely eliminate trans fats' },
      sodium:         { max: 1500,    unit: 'mg' },
      omega3:         { min: 1,       unit: 'g',  note: 'EPA + DHA — from oily fish or supplement' },
      fibre:          { min: 30,      unit: 'g' },
    },
    allowed_foods: {
      food_groups: ['Oily fish', 'Olive oil', 'Whole grains', 'Legumes', 'Colourful vegetables', 'Berries', 'Nuts (unsalted)'],
      examples: ['Salmon', 'Sardines', 'Walnuts', 'Flaxseed', 'Oats', 'Spinach', 'Broccoli', 'Blueberries', 'Extra-virgin olive oil', 'Avocado'],
    },
    restricted_foods: {
      food_groups: ['Trans fats', 'Saturated fats', 'Sodium', 'Added sugars', 'Alcohol'],
      items: ['Butter', 'Hydrogenated oils', 'Margarine', 'Red meat (fatty cuts)', 'Full-fat dairy', 'Pastries', 'Fried food', 'Alcohol'],
      reasons: {
        'Trans fats': 'Directly increase LDL and decrease HDL — highest cardiovascular risk.',
        'Saturated fats': 'Raise LDL cholesterol; replace with unsaturated alternatives.',
      },
    },
    meal_timing_tips: [
      'Aim for a Mediterranean-style eating pattern.',
      'Eat oily fish at least twice a week.',
      'Use olive oil as your primary cooking fat.',
      'Avoid adding salt at the table; use herbs and spices.',
    ],
    hydration_ml: 2000,
    supplement_notes: 'Discuss Omega-3 supplementation with your cardiologist. CoQ10 may be discussed for statin users.',
    emergency_foods: ['Handful of walnuts', 'Banana', 'Oatmeal', 'Avocado'],
  },

  HIGH_PROTEIN_SOFT: {
    name: 'High-Protein Soft Diet (Post-Operative Recovery)',
    guideline_source: 'ESPEN Guidelines on Clinical Nutrition in Surgery (2017)',
    daily_targets: {
      calories:  { amount: 2200, unit: 'kcal' },
      protein:   { amount: 1.5,  unit: 'g/kg_body_weight', note: 'Essential for wound healing and muscle preservation' },
      vitamin_c: { min: 500,     unit: 'mg',  note: 'Collagen synthesis for wound healing' },
      zinc:      { min: 15,      unit: 'mg' },
    },
    allowed_foods: {
      food_groups: ['Soft-cooked proteins', 'Mashed vegetables', 'Smooth soups', 'High-protein dairy', 'Soft fruits'],
      examples: ['Scrambled eggs', 'Boiled fish', 'Minced chicken', 'Smooth lentil soup', 'Mashed potato', 'Steamed carrots', 'Yoghurt', 'Soft tofu', 'Banana', 'Papaya', 'Porridge'],
    },
    restricted_foods: {
      food_groups: ['Hard/crunchy foods', 'Spicy foods', 'Alcohol', 'Carbonated drinks', 'Raw vegetables (early recovery)'],
      items: ['Nuts', 'Raw carrots', 'Crusty bread', 'Chillies', 'Alcohol', 'Fizzy drinks'],
      reasons: {
        'Hard/crunchy foods': 'Risk of choking and surgical wound stress.',
        'Spicy foods': 'Gastrointestinal irritation in post-operative GI tract.',
        'Alcohol': 'Impairs immune function and wound healing.',
      },
    },
    meal_timing_tips: [
      'Eat small, frequent meals (5–6 times per day) to meet caloric targets without overloading.',
      'Introduce solid foods progressively — start with smooth, then soft, then regular textures.',
      'Prioritise protein at every meal: aim for 25–30g protein per meal.',
      'Supplement with Vitamin C-rich foods (orange juice, guava) at each meal.',
    ],
    hydration_ml: 2500,
    supplement_notes: 'Discuss Zinc, Vitamin C, and Vitamin D supplementation with your surgeon/dietitian post-operatively.',
    emergency_foods: ['Yoghurt', 'Scrambled eggs', 'Smooth soup', 'Banana'],
  },

  LOW_FAT: {
    name: 'Low-Fat Diet (Dyslipidaemia / Gallbladder Management)',
    guideline_source: 'ACC/AHA 2019 Guideline on Cardiovascular Risk Reduction',
    daily_targets: {
      total_fat:     { max: 20,  unit: '%_calories' },
      saturated_fat: { max: 7,   unit: '%_calories' },
      cholesterol:   { max: 200, unit: 'mg' },
      fibre:         { min: 30,  unit: 'g' },
    },
    allowed_foods: {
      food_groups: ['Lean protein', 'Whole grains', 'Fruits', 'Vegetables', 'Low-fat dairy'],
      examples: ['Chicken breast (skinless)', 'Turkey', 'Fish (not fried)', 'Oats', 'Brown rice', 'All fruits', 'All vegetables', 'Skimmed milk', 'Low-fat yoghurt'],
    },
    restricted_foods: {
      food_groups: ['Full-fat dairy', 'Fried foods', 'Fatty meats', 'Coconut oil / palm oil', 'Pastries'],
      items: ['Whole milk', 'Cream', 'Butter', 'Ghee', 'Coconut oil', 'Fatty pork / lamb', 'Deep-fried foods', 'Croissants', 'Ice cream'],
      reasons: {
        'Full-fat dairy': 'High saturated fat content raises LDL.',
        'Fried foods': 'Trans fat and excess calorie load.',
        'Coconut oil / palm oil': 'Highest saturated fat among vegetable oils — counterproductive for LDL control.',
      },
    },
    meal_timing_tips: [
      'Cook using steaming, grilling, baking, or boiling — avoid frying.',
      'Use non-stick pans with olive oil spray (minimal amount).',
      'Read food labels: aim for < 3g fat per 100g for packaged foods.',
    ],
    hydration_ml: 2000,
    supplement_notes: 'Psyllium husk (ispaghula) 5–10g/day can reduce LDL by up to 10% — discuss with doctor.',
    emergency_foods: ['Apple', 'Banana', 'Oatmeal', 'Grilled chicken'],
  },

  ANTI_INFLAMMATORY: {
    name: 'Anti-Inflammatory Mediterranean Diet',
    guideline_source: 'Estruch et al., NEJM 2013 / European League Against Rheumatism (EULAR) Recommendations',
    daily_targets: {
      omega3:        { min: 2,  unit: 'g',  note: 'EPA + DHA from oily fish (3x/week) or supplement' },
      antioxidants:  { note: 'Maximise via colourful vegetables and fruits' },
      processed_food:{ max: 0,  note: 'Eliminate ultra-processed foods entirely' },
    },
    allowed_foods: {
      food_groups: ['Oily fish', 'Colourful vegetables', 'Berries', 'Whole grains', 'Legumes', 'Nuts', 'Olive oil', 'Spices'],
      examples: ['Salmon', 'Mackerel', 'Turmeric', 'Ginger', 'Broccoli', 'Blueberries', 'Pomegranate', 'Walnuts', 'Chickpeas', 'Quinoa', 'Green tea'],
    },
    restricted_foods: {
      food_groups: ['Refined carbohydrates', 'Fried foods', 'Red meat', 'Sugary beverages', 'Alcohol (>1 unit/day)', 'Processed/ultra-processed foods'],
      items: ['White bread', 'Chips', 'Fast food', 'Soda', 'Processed meats', 'Margarine'],
      reasons: {
        'Refined carbohydrates': 'Pro-inflammatory insulin spikes.',
        'Red meat': 'Arachidonic acid promotes inflammatory pathways.',
        'Ultra-processed foods': 'Contain pro-inflammatory additives, refined oils, and excess sugar.',
      },
    },
    meal_timing_tips: [
      'Eat oily fish at least 3 times per week.',
      'Add turmeric and ginger to cooking daily (curcumin is a natural anti-inflammatory).',
      'Drink 2–3 cups of green tea daily for antioxidant polyphenols.',
      'Replace red meat with legumes at least 3 days per week.',
    ],
    hydration_ml: 2500,
    supplement_notes: 'Discuss Omega-3 (EPA+DHA) 2g/day, Vitamin D 1000–2000IU/day, and Curcumin supplementation with your rheumatologist.',
    emergency_foods: ['Handful of walnuts', 'Green tea', 'Blueberries', 'Salmon tinned'],
  },

  NEUTROPENIC: {
    name: 'Neutropenic Diet (Immunocompromised / Oncology Protocol)',
    guideline_source: 'ASCO Guidelines for Dietary Management during Chemotherapy (2021)',
    daily_targets: {
      calories:  { amount: 2200, unit: 'kcal', note: 'High energy needs during chemotherapy' },
      protein:   { amount: 1.5,  unit: 'g/kg_body_weight' },
    },
    allowed_foods: {
      food_groups: ['Well-cooked meats', 'Pasteurised dairy', 'Cooked vegetables', 'Canned or cooked fruits', 'Packaged sealed foods'],
      examples: ['Thoroughly cooked chicken', 'Pasteurised milk', 'Cooked carrots', 'Tinned peaches', 'Packaged crackers', 'Boiled eggs', 'Well-cooked rice'],
    },
    restricted_foods: {
      food_groups: ['Raw meat / fish / eggs', 'Unwashed raw produce', 'Unpasteurised products', 'Mold-ripened cheese', 'Deli meats', 'Buffet/self-service food'],
      items: ['Sushi', 'Salads (unless washed at home)', 'Blue cheese', 'Brie', 'Camembert', 'Deli sliced meats', 'Buffet food', 'Undercooked eggs', 'Raw sprouts'],
      reasons: {
        'Raw meat / fish': 'High risk of Salmonella, Listeria, Campylobacter — life-threatening in neutropenia.',
        'Mold-ripened cheese': 'Risk of Listeria and fungal contamination.',
        'Buffet / deli': 'Unknown temperature control — high pathogen risk.',
      },
    },
    meal_timing_tips: [
      'Cook ALL foods to safe internal temperatures (chicken 74°C, beef 71°C, eggs fully set).',
      'Wash hands for 20 seconds before handling food.',
      'Store cooked food in sealed containers; refrigerate within 2 hours of cooking.',
      'Avoid eating out at restaurants during chemotherapy cycles when WBC count is lowest.',
    ],
    hydration_ml: 3000,
    supplement_notes: 'Avoid herbal supplements and megadose vitamins unless approved by your oncologist — some interact with chemotherapy.',
    emergency_foods: ['Tinned soup (low-sodium)', 'Crackers', 'Banana', 'Pasteurised yoghurt'],
  },

  TEXTURE_MODIFIED: {
    name: 'Texture-Modified Diet (Dysphagia Protocol — IDDSI Level 6 Soft & Bite-Sized)',
    guideline_source: 'International Dysphagia Diet Standardisation Initiative (IDDSI) Framework v2 (2019)',
    daily_targets: {
      calories:  { amount: 2000, unit: 'kcal' },
      protein:   { amount: 1.2,  unit: 'g/kg_body_weight' },
    },
    allowed_foods: {
      food_groups: ['Soft-cooked meats', 'Mashed vegetables', 'Smooth soups', 'Soft dairy', 'Soft breads', 'Cooked cereals'],
      examples: ['Minced chicken', 'Soft-poached fish', 'Mashed potato', 'Smooth lentil soup', 'Soft-cooked eggs', 'Yoghurt', 'Porridge', 'Soft banana', 'Steamed cauliflower'],
    },
    restricted_foods: {
      food_groups: ['Hard, crunchy, dry foods', 'Sticky foods', 'Mixed textures', 'Fibrous meats', 'Thin liquids (if dysphagia-specific)'],
      items: ['Nuts', 'Raw carrots', 'Celery', 'Dry crackers', 'Peanut butter (sticky)', 'Toffee', 'Bread with crusts', 'Corn on the cob'],
      reasons: {
        'Hard, crunchy foods': 'Aspiration risk — food particles may enter airway.',
        'Sticky foods': 'Cannot be cleared from mouth/throat safely.',
        'Mixed textures': 'Unpredictable — liquids separate from solids causing aspiration.',
      },
    },
    meal_timing_tips: [
      'Sit fully upright (90°) when eating — maintain position for 30 minutes after meals.',
      'Take small bites and chew thoroughly.',
      'Do not rush meals — allow adequate time per meal (30–45 minutes).',
      'A speech-language pathologist (SLP) must confirm your safe texture level.',
    ],
    hydration_ml: 2000,
    supplement_notes: 'Liquid thickeners may be required for safe hydration — confirm with your SLP. Discuss nutritional supplement drinks (Ensure, Fresubin) with your dietitian.',
    emergency_foods: ['Yoghurt', 'Smooth soup', 'Mashed banana', 'Scrambled eggs'],
  },

  STANDARD_BALANCED: {
    name: 'Standard Balanced Diet (Preventive Wellness)',
    guideline_source: 'WHO Healthy Diet Guidelines (2020) / ICMR Dietary Reference Values for Indians',
    daily_targets: {
      calories:       { amount: 2000, unit: 'kcal' },
      protein:        { amount: 0.8,  unit: 'g/kg_body_weight' },
      carbohydrates:  { amount: 50,   unit: '%_calories' },
      fat:            { amount: 30,   unit: '%_calories' },
      fibre:          { min: 25,      unit: 'g' },
      fruits_veg:     { min: 5,       unit: 'servings/day', note: 'Minimum 5 portions of varied fruits and vegetables' },
    },
    allowed_foods: {
      food_groups: ['All food groups in moderation', 'Whole grains preferred', 'Lean proteins', 'Healthy fats', 'Variety of fruits and vegetables'],
      examples: ['Brown rice', 'Whole wheat chapati', 'Dal', 'Grilled fish or chicken', 'Seasonal vegetables', 'Fruit', 'Low-fat dairy', 'Nuts (small amounts)', 'Olive or canola oil'],
    },
    restricted_foods: {
      food_groups: ['Ultra-processed foods', 'Excessive sugar', 'Excess sodium', 'Alcohol (limit)'],
      items: ['Packaged snacks', 'Sugary drinks', 'Excess salt', 'Alcohol beyond 1–2 units/week'],
      reasons: {
        'Ultra-processed foods': 'Associated with all-cause mortality, obesity, and metabolic disease.',
        'Excessive sugar': 'Contributes to obesity, dental caries, and metabolic disease.',
      },
    },
    meal_timing_tips: [
      'Eat 3 main meals with 1–2 light snacks if needed.',
      'Prioritise variety — eat different coloured fruits and vegetables daily.',
      'Cook at home when possible — restaurant meals average 3× higher sodium and calories.',
      'Aim for at least 150 minutes of moderate physical activity per week.',
    ],
    hydration_ml: 2500,
    supplement_notes: 'Vitamin D (especially for indoor workers), Vitamin B12 (for strict vegetarians/vegans), and Iron (for women of reproductive age) may be considered after blood testing.',
    emergency_foods: ['Any seasonal fruit', 'Dal and rice', 'Boiled egg', 'Whole wheat bread'],
  },
};

// ─── Protocol Resolver ────────────────────────────────────────────────────────

/**
 * Resolves the most appropriate nutrition protocol for a given list of conditions.
 * Uses priority-ordered matching; highest-priority (lowest number) match wins.
 *
 * @param {string[]} conditions  - Array of diagnosis/condition strings
 * @returns {{ protocol: string, matchedConditions: string[], protocolData: NutritionProtocol }}
 */
export function resolveProtocol(conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return {
      protocol: 'STANDARD_BALANCED',
      matchedConditions: [],
      protocolData: NUTRITION_PROTOCOLS.STANDARD_BALANCED,
    };
  }

  const matches = [];

  for (const condition of conditions) {
    if (!condition) continue;
    for (const entry of CONDITION_PROTOCOL_MAP) {
      if (entry.pattern.test(condition)) {
        matches.push({ protocol: entry.protocol, priority: entry.priority, condition });
        break; // One match per condition string
      }
    }
  }

  if (matches.length === 0) {
    return {
      protocol: 'STANDARD_BALANCED',
      matchedConditions: conditions,
      protocolData: NUTRITION_PROTOCOLS.STANDARD_BALANCED,
    };
  }

  // Sort by priority (ascending = most specific / medically urgent first)
  matches.sort((a, b) => a.priority - b.priority);

  const selectedProtocol = matches[0].protocol;
  const matchedConditions = matches.map(m => m.condition);

  return {
    protocol: selectedProtocol,
    matchedConditions,
    protocolData: NUTRITION_PROTOCOLS[selectedProtocol] || NUTRITION_PROTOCOLS.STANDARD_BALANCED,
  };
}

// ─── Nutrition Plan Creation ──────────────────────────────────────────────────

/**
 * Creates and persists a clinical nutrition plan for a patient.
 *
 * @param {Object} params
 * @param {string}    params.patientId
 * @param {string}    params.prescribedBy    - Doctor/dietitian user ID
 * @param {string[]}  params.conditions      - Active diagnoses / conditions
 * @param {string}    [params.visitId]
 * @param {string}    [params.overrideProtocol] - Force a specific protocol (bypasses resolver)
 * @param {string}    [params.notes]
 * @param {number}    [params.validDays=90]  - Days the plan is valid
 * @returns {Promise<Object>} Persisted nutrition plan
 */
export async function createNutritionPlan({
  patientId,
  prescribedBy,
  conditions,
  visitId = null,
  overrideProtocol = null,
  notes = null,
  validDays = 90,
}) {
  const { protocol, matchedConditions, protocolData } = overrideProtocol
    ? { protocol: overrideProtocol, matchedConditions: conditions, protocolData: NUTRITION_PROTOCOLS[overrideProtocol] }
    : resolveProtocol(conditions);

  if (!protocolData) {
    throw Object.assign(new Error(`Unknown protocol: ${protocol}`), { code: 'INVALID_PROTOCOL', status: 400 });
  }

  const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);

  const plans = await prisma.$queryRawUnsafe(
    `INSERT INTO nutrition_plans
       (patient_id, visit_id, prescribed_by, protocol, conditions,
        allowed_foods, restricted_foods, daily_targets, meal_timing_tips,
        hydration_ml, supplement_notes, emergency_foods, notes,
        is_active, valid_from, valid_until, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::TEXT[], $6::JSONB, $7::JSONB, $8::JSONB,
             $9::JSONB, $10, $11, $12::TEXT[], $13, TRUE, NOW(), $14, NOW(), NOW())
     RETURNING *`,
    patientId,
    visitId,
    prescribedBy,
    protocol,
    matchedConditions,
    JSON.stringify(protocolData.allowed_foods),
    JSON.stringify(protocolData.restricted_foods),
    JSON.stringify(protocolData.daily_targets),
    JSON.stringify(protocolData.meal_timing_tips),
    protocolData.hydration_ml,
    protocolData.supplement_notes,
    protocolData.emergency_foods,
    notes || `${protocolData.name}. Source: ${protocolData.guideline_source}`,
    validUntil,
  );

  return { plan: plans[0], protocol, protocolData };
}

// ─── Dietitian Appointment Booking ───────────────────────────────────────────

/**
 * Books a dietitian appointment slot transactionally.
 * Prevents double-booking via database UNIQUE constraint on (dietitian_id, slot_start).
 *
 * @param {Object} params
 * @param {string}   params.patientId
 * @param {string}   params.dietitianId          - StaffMember ID
 * @param {string}   params.dietitianName
 * @param {Date}     params.slotStart            - Appointment start time
 * @param {Date}     params.slotEnd              - Appointment end time
 * @param {string}   [params.nutritionPlanId]
 * @param {string}   [params.mode='IN_PERSON']   - 'IN_PERSON' | 'TELEHEALTH'
 * @param {string}   [params.location]
 * @param {string}   [params.timezone='Asia/Kolkata']
 * @param {string}   [params.notes]
 * @returns {Promise<Object>} Created appointment
 */
export async function bookDietitianAppointment({
  patientId,
  dietitianId,
  dietitianName,
  slotStart,
  slotEnd,
  nutritionPlanId = null,
  mode = 'IN_PERSON',
  location = null,
  timezone = 'Asia/Kolkata',
  notes = null,
}) {
  // Validate slot times
  const start = new Date(slotStart);
  const end   = new Date(slotEnd);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw Object.assign(new Error('Invalid slot start or end time.'), { code: 'INVALID_SLOT_TIME', status: 400 });
  }
  if (end <= start) {
    throw Object.assign(new Error('Slot end must be after slot start.'), { code: 'INVALID_SLOT_RANGE', status: 400 });
  }
  if (start < new Date()) {
    throw Object.assign(new Error('Cannot book a slot in the past.'), { code: 'PAST_SLOT', status: 400 });
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO dietitian_appointments
         (patient_id, nutrition_plan_id, dietitian_id, dietitian_name,
          slot_start, slot_end, timezone, location, mode,
          status, booked_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', NOW(), NOW(), NOW())
       RETURNING *`,
      patientId,
      nutritionPlanId,
      dietitianId,
      dietitianName,
      start,
      end,
      timezone,
      location,
      mode,
    );

    return rows[0];
  } catch (err) {
    // PostgreSQL unique violation code: 23505
    if (err.code === '23505' || err.message?.includes('uq_dietitian_slot')) {
      throw Object.assign(
        new Error(`Dietitian slot at ${start.toISOString()} is already booked. Please select a different time.`),
        { code: 'SLOT_CONFLICT', status: 409 }
      );
    }
    throw err;
  }
}

/**
 * Returns available dietitian appointment slots within a given date range.
 * Excludes already-booked slots (PENDING or CONFIRMED).
 *
 * @param {string}  dietitianId
 * @param {Date}    fromDate
 * @param {Date}    toDate
 * @returns {Promise<{ bookedSlots: Date[], availableCount: number }>}
 */
export async function getDietitianAvailability(dietitianId, fromDate, toDate) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT slot_start, slot_end FROM dietitian_appointments
     WHERE dietitian_id = $1
       AND status IN ('PENDING', 'CONFIRMED')
       AND slot_start >= $2
       AND slot_end   <= $3
     ORDER BY slot_start ASC`,
    dietitianId,
    new Date(fromDate),
    new Date(toDate),
  );

  return {
    bookedSlots: rows.map(r => ({ start: r.slot_start, end: r.slot_end })),
    availableCount: null, // External calendar integration would populate this
  };
}

/**
 * Gets the active nutrition plan for a patient, if one exists.
 *
 * @param {string} patientId
 * @returns {Promise<Object|null>}
 */
export async function getActiveNutritionPlan(patientId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM nutrition_plans
     WHERE patient_id = $1
       AND is_active = TRUE
       AND (valid_until IS NULL OR valid_until > NOW())
     ORDER BY created_at DESC
     LIMIT 1`,
    patientId,
  );
  return rows[0] || null;
}

/**
 * Returns the full protocol data for a given protocol code.
 * Useful for the patient UI to display detailed dietary guidelines.
 *
 * @param {string} protocolCode
 * @returns {NutritionProtocol|null}
 */
export function getProtocolData(protocolCode) {
  return NUTRITION_PROTOCOLS[protocolCode] || null;
}

export const ClinicalDietService = {
  resolveProtocol,
  createNutritionPlan,
  bookDietitianAppointment,
  getDietitianAvailability,
  getActiveNutritionPlan,
  getProtocolData,
  NUTRITION_PROTOCOLS,
};

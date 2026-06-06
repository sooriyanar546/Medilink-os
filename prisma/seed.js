const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Start seeding...');

  // Hash passwords securely
  const patientHash = await bcrypt.hash('patient123', 10);
  const doctorHash = await bcrypt.hash('doctor123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  // 1. Create Patient
  const patient = await prisma.patient.upsert({
    where: { phone: '+1234567890' },
    update: {},
    create: {
      name: 'Michael Chen',
      dob: new Date('1980-01-01'),
      phone: '+1234567890',
      email: 'patient@medilink.com',
    },
  });

  // 2. Create Patient User (NextAuth)
  await prisma.user.upsert({
    where: { email: 'patient@medilink.com' },
    update: { password: patientHash },
    create: {
      name: 'Michael Chen',
      email: 'patient@medilink.com',
      password: patientHash,
      role: 'PATIENT',
      department: 'OPD Patient',
      patientId: patient.id,
    },
  });

  // 3. Create Doctor
  // Using an email-like ID for the demo doctor so we can upsert easily
  // Wait, Doctor doesn't have an email or phone field in the schema. We'll find by ID.
  const doctor = await prisma.doctor.upsert({
    where: { id: 'doc_sarah_jenkins' },
    update: {},
    create: {
      id: 'doc_sarah_jenkins',
      name: 'Dr. Sarah Jenkins',
      specialization: 'Cardiology',
      department: 'Cardiology',
    },
  });

  // 4. Create Doctor User (NextAuth)
  await prisma.user.upsert({
    where: { email: 'doctor@medilink.com' },
    update: { password: doctorHash },
    create: {
      name: 'Dr. Sarah Jenkins',
      email: 'doctor@medilink.com',
      password: doctorHash,
      role: 'DOCTOR',
      department: 'Cardiology',
      doctorId: doctor.id,
    },
  });

  // 5. Create Admin User (NextAuth)
  await prisma.user.upsert({
    where: { email: 'admin@medilink.com' },
    update: { password: adminHash },
    create: {
      name: 'Alex Operations',
      email: 'admin@medilink.com',
      password: adminHash,
      role: 'ADMIN',
      department: 'Hospital Admin',
    },
  });

  // 5a. Create Nurse User (NextAuth)
  const nurseHash = await bcrypt.hash('nurse123', 10);
  await prisma.user.upsert({
    where: { email: 'nurse@medilink.com' },
    update: { password: nurseHash },
    create: {
      name: 'Nurse Joy',
      email: 'nurse@medilink.com',
      password: nurseHash,
      role: 'NURSE',
      department: 'Triage',
    },
  });

  // 5b. Create Pharmacist and Cashier Users
  const pharmacyHash = await bcrypt.hash('pharmacy123', 10);
  await prisma.user.upsert({
    where: { email: 'pharmacy@medilink.com' },
    update: { password: pharmacyHash },
    create: {
      name: 'Dr. Gregory (Pharmacy)',
      email: 'pharmacy@medilink.com',
      password: pharmacyHash,
      role: 'PHARMACIST',
      department: 'Pharmacy',
    },
  });

  const cashierHash = await bcrypt.hash('cashier123', 10);
  await prisma.user.upsert({
    where: { email: 'cashier@medilink.com' },
    update: { password: cashierHash },
    create: {
      name: 'Sarah (Billing)',
      email: 'cashier@medilink.com',
      password: cashierHash,
      role: 'CASHIER',
      department: 'Billing & Insurance',
    },
  });

  // 6. Create Additional Patients for the Queue
  const patient2 = await prisma.patient.upsert({
    where: { phone: '+1234567891' },
    update: {},
    create: {
      name: 'Emma Watson',
      dob: new Date('1992-05-15'),
      phone: '+1234567891',
      email: 'emma@example.com',
    },
  });

  const patient3 = await prisma.patient.upsert({
    where: { phone: '+1234567892' },
    update: {},
    create: {
      name: 'James Rodriguez',
      dob: new Date('1985-08-22'),
      phone: '+1234567892',
      email: 'james@example.com',
    },
  });

  // 7. Seed the Visit Queue for Dr. Sarah Jenkins
  console.log('Seeding Visits for live queue...');
  
  // Clear existing active visits for clean slate
  await prisma.billingClaim.deleteMany();
  await prisma.labReport.deleteMany();
  await prisma.clinicalNote.deleteMany();
  await prisma.visit.deleteMany({
    where: {
      doctorId: doctor.id,
    }
  });

  await prisma.visit.create({
    data: {
      patientId: patient.id, // Michael Chen
      doctorId: doctor.id,
      status: 'CONSULTING',
      reason: 'Routine checkup and labs',
      queuePosition: 1,
      waitTime: 0,
      consultedAt: new Date(),
    }
  });

  await prisma.visit.create({
    data: {
      patientId: patient2.id, // Emma Watson
      doctorId: doctor.id,
      status: 'WAITING',
      reason: 'Chest pain',
      queuePosition: 2,
      waitTime: 15,
      isCritical: true,
    }
  });

  await prisma.visit.create({
    data: {
      patientId: patient3.id, // James Rodriguez
      doctorId: doctor.id,
      status: 'WAITING',
      reason: 'Follow-up on ECG',
      queuePosition: 3,
      waitTime: 30,
    }
  });

  // 8. Seed Ward Beds
  console.log('Seeding Ward Beds...');
  await prisma.wardBed.deleteMany();
  
  const bedsData = [
    // ICU
    { name: 'ICU-01', wardType: 'ICU', status: 'AVAILABLE', ventilator: false, notes: 'Ventilator standby' },
    { name: 'ICU-02', wardType: 'ICU', status: 'AVAILABLE', ventilator: false, notes: 'Ventilator standby' },
    { name: 'ICU-03', wardType: 'ICU', status: 'AVAILABLE', ventilator: false, notes: 'Ventilator standby' },
    { name: 'ICU-04', wardType: 'ICU', status: 'AVAILABLE', ventilator: false, notes: 'Ventilator standby' },
    
    // ER
    { name: 'ER-01', wardType: 'ER', status: 'AVAILABLE', ventilator: false, notes: 'Crash cart adjacent' },
    { name: 'ER-02', wardType: 'ER', status: 'AVAILABLE', ventilator: false, notes: 'Crash cart adjacent' },
    { name: 'ER-03', wardType: 'ER', status: 'AVAILABLE', ventilator: false, notes: 'Crash cart adjacent' },
    { name: 'ER-04', wardType: 'ER', status: 'AVAILABLE', ventilator: false, notes: 'Crash cart adjacent' },
    
    // GENERAL
    { name: 'GEN-01', wardType: 'GENERAL', status: 'AVAILABLE', ventilator: false, notes: 'Window view' },
    { name: 'GEN-02', wardType: 'GENERAL', status: 'AVAILABLE', ventilator: false, notes: 'Near nurse station' },
    { name: 'GEN-03', wardType: 'GENERAL', status: 'AVAILABLE', ventilator: false, notes: 'Near nurse station' },
    { name: 'GEN-04', wardType: 'GENERAL', status: 'AVAILABLE', ventilator: false, notes: 'Recuperative care' },
    
    // ISOLATION
    { name: 'ISO-01', wardType: 'ISOLATION', status: 'AVAILABLE', ventilator: false, notes: 'Negative pressure room' },
    { name: 'ISO-02', wardType: 'ISOLATION', status: 'AVAILABLE', ventilator: false, notes: 'Negative pressure room' }
  ];

  for (const bed of bedsData) {
    await prisma.wardBed.create({
      data: bed
    });
  }

  console.log('Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

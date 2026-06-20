const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'patient@medilink.com' }
    });
    if (user) {
      const isMatch = await bcrypt.compare('patient123', user.password);
      console.log(`User: ${user.email}`);
      console.log(`Stored Hash: ${user.password}`);
      console.log(`Compare Match with 'patient123': ${isMatch}`);
    } else {
      console.log("Patient user not found.");
    }
  } catch (e) {
    console.error("Database query failed:", e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

check();

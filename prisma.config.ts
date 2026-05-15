// Prisma v7 config — database URL is managed here, not in schema.prisma
import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

// Load .env.local for Next.js compatibility
dotenv.config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});

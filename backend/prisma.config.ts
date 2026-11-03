import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // A connection is not needed for generation/validation. Runtime validates .env strictly.
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://example.invalid/not-configured?sslmode=verify-full" },
});

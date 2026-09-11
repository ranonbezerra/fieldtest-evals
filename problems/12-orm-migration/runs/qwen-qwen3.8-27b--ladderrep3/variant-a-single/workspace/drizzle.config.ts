import { defineConfig } from 'drizzle-kit';

// DATABASE_URL comes from the environment; nothing is hardcoded here.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/billing/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});

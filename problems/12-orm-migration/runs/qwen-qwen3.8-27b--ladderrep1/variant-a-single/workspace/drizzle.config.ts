import { defineConfig } from 'drizzle-kit';

// DATABASE_URL is the only configuration source; no connection strings live in the repo.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/billing/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});

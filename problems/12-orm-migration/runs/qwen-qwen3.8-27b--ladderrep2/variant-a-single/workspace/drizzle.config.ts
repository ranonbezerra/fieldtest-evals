import { defineConfig } from 'drizzle-kit';

// Configuration comes from the environment only (project convention): DATABASE_URL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});

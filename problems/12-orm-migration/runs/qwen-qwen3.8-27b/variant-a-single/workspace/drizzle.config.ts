import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  // Configuration comes from the environment only; `db:generate` does not
  // need a live database, `db:migrate` does.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});

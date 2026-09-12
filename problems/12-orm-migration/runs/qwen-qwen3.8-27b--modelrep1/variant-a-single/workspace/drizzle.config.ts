import { defineConfig } from 'drizzle-kit';

// `pnpm db:migrate` applies drizzle/ against DATABASE_URL (production path);
// the test suite applies the same files via the pglite migrator.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/billing/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

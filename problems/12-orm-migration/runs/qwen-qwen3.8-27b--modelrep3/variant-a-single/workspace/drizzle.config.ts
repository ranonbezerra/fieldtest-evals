import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/db.schema.ts',
  out: './drizzle',
  dbCredentials: {
    // env only -- never a connection string in the repo
    url: process.env.DATABASE_URL ?? '',
  },
});

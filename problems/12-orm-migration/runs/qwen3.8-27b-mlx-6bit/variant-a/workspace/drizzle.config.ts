import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'pg',
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
});

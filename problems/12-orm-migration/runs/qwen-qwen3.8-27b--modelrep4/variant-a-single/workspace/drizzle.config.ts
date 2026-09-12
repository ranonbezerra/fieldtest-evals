import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/billing/schema.ts',
  out: './drizzle',
});

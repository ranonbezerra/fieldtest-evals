import { defineConfig } from 'drizzle-kit';
import * as schema from './src/db/schema.js';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!
  }
});

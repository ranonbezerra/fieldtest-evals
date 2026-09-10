import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every suite shares the single Postgres database named by DATABASE_URL
    // (each one drops and rebuilds the schema), so spec files must run one
    // after another, never in parallel.
    fileParallelism: false,
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

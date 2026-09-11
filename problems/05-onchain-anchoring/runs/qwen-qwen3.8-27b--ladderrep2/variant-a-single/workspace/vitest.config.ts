import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // The specs share one Postgres database and clean it between tests;
    // running spec files in parallel would make them trample each other.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

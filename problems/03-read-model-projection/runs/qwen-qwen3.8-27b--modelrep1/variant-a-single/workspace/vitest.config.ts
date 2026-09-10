import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // The specs share one database and reset it between tests, so they must
    // not run in parallel.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DRIFT_REPAIR_ENABLED: 'false',
    },
  },
});

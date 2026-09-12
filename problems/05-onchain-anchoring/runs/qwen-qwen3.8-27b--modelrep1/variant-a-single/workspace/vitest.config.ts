import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // The specs share one PostgreSQL database (the anchors table), so the
    // test files must never run in parallel.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

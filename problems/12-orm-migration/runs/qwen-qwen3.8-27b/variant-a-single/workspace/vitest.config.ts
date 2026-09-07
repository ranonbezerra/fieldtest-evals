import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Files share one database and one migration journal; run serially so
    // schema bootstrap and state assumptions stay deterministic.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});

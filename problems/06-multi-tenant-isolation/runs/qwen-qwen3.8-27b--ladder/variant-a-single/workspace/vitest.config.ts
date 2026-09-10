import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // the specs share one database and reset it in beforeAll; run files one at a time
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});

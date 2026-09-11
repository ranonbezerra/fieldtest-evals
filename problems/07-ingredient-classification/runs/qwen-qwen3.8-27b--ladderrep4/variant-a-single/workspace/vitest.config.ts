import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The specs share one PostgreSQL database; run files serially so their
    // beforeEach wipes do not interleave.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The specs share one database and truncate the same tables, so they must
    // run one file at a time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

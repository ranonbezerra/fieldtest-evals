import { defineConfig } from 'vitest/config';

// The DB-backed suite boots a real (WASM) Postgres engine per test file;
// give the init hooks room to breathe on slow machines.
export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

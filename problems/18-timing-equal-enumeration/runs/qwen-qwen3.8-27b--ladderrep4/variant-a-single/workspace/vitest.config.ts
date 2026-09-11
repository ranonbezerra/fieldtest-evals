import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // The timing tests sample the full KDF cost many times; give them headroom.
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});

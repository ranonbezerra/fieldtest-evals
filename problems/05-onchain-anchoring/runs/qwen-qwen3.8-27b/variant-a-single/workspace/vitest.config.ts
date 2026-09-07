import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});

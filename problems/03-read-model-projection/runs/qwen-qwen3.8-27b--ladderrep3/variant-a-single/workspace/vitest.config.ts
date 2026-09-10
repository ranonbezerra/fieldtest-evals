import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One process for all suites: they share one database and must not race.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

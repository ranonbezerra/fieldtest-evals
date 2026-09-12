import { defineConfig } from 'vitest/config';
import swc from '@vitejs/plugin-swc';

export default defineConfig({
  plugins: [
    // NestJS constructor injection relies on `design:paramtypes` metadata,
    // which esbuild (Vite's default TS transform) cannot emit.
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, useDefineForClassFields: false },
        target: 'es2022',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Specs share one Postgres database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

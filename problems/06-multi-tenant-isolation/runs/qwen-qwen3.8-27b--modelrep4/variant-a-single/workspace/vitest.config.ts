import swc from '@vitejs/plugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is used instead of esbuild because esbuild cannot emit decorator
// metadata, and NestJS dependency injection relies on it.
export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: 'es2022',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

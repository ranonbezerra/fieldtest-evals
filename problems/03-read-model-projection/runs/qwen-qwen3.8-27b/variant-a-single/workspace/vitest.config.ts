import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (instead of esbuild) because NestJS constructor injection relies on
// emitted decorator metadata (design:paramtypes), which esbuild cannot emit.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
  },
});

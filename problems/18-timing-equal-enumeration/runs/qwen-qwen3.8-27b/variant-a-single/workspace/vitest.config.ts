import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});

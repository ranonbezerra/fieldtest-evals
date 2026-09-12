import swc from '@vitest/plugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (instead of the default esbuild transform) so legacy decorators and
// decorator metadata required by NestJS dependency injection are emitted.
export default defineConfig({
  plugins: [
    swc({
      jsc: {
        parser: { syntax: 'typescript', tsx: false, decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

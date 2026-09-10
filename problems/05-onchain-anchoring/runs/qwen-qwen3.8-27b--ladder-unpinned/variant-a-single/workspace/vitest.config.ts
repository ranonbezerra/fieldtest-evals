import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Crash-recovery tests spawn a real child process; leave them room.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});

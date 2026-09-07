import { defineConfig } from 'vitest/config';

// ASSUMPTION: A non-sensitive placeholder is enough because the wiring check never opens a database connection.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/wiring?schema=public';

export default defineConfig({
  esbuild: {
    tsconfig: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});

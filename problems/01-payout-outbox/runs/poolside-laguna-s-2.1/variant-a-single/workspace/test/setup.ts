// Ensure test environment variables are set
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable must be set for tests');
}

process.env.NODE_ENV = 'test';
process.env.WORKER_ENABLED = 'false';

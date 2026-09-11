// Drizzle Kit configuration. The schema source of truth is
// src/billing/schema.ts; migrations live in ./drizzle. When drizzle-kit
// needs to talk to a database it reads DATABASE_URL from the environment.
export default {
  dialect: 'postgresql',
  schema: './src/billing/schema.ts',
  out: './drizzle',
};

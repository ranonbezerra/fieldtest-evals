// Every external credential is resolved here, once, at boot. `requireEnv` throws
// during module init, so a misconfigured deploy fails to start instead of failing
// on the first user request.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable: ${name}`);
  return v;
}

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  providerWebhookSecret: requireEnv('PROVIDER_WEBHOOK_SECRET'),
  sesRegion: requireEnv('SES_REGION'),
};

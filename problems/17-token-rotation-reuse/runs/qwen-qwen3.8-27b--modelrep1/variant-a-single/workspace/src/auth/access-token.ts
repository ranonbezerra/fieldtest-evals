import { randomBytes } from 'node:crypto';

// Stand-in for the pre-existing access-token issuer (see the
// ACCESS_TOKEN_ISSUER binding and its assumption note in auth.module.ts).
// Replace the body with the real implementation, or re-point the provider.
export function issueAccessToken(userId: string): string {
  return `at.${encodeURIComponent(userId)}.${randomBytes(24).toString('base64url')}`;
}

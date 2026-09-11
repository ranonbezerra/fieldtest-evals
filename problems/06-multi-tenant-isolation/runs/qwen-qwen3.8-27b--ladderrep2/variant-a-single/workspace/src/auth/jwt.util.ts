import { createHmac, timingSafeEqual } from 'node:crypto';

// ASSUMPTION: auth tokens are HS256 JWTs signed with the shared secret from
// the JWT_SECRET environment variable, and their `org` claim carries the
// tenant slug the principal belongs to (e.g. "operator-a"). The task fixes
// the claim name but not the token format.

const b64url = (input: Buffer): string => input.toString('base64url');

export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })));
  const signature = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  // No configured secret means no token can ever verify: fail closed.
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = Buffer.from(b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest()));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.exp === 'number' && record.exp < Math.floor(Date.now() / 1000)) return null;
  return record;
}

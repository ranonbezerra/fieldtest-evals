import { createHmac, timingSafeEqual } from 'node:crypto';
import { TokenUnverifiedError } from './token-unverified.error.js';
import type { TokenVerifier, TokenVerificationResult } from './token-verifier.contract.js';

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');
const fromB64url = (input: string): Buffer => Buffer.from(input, 'base64url');

/**
 * HS256 bearer-token verifier. The `org` claim carries the tenant
 * identifier; it is returned only after the signature verifies.
 */
export class JwtTokenVerifier implements TokenVerifier {
  constructor(private readonly secret: string) {}

  async verify(token: string): Promise<TokenVerificationResult> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new TokenUnverifiedError('Malformed token: expected three dot-separated parts.');
    }
    const [headerB64, payloadB64, signatureB64] = parts;
    const expected = createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const actual = fromB64url(signatureB64);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new TokenUnverifiedError('Token signature verification failed.');
    }
    let claims: unknown;
    try {
      claims = JSON.parse(fromB64url(payloadB64).toString('utf8'));
    } catch {
      throw new TokenUnverifiedError('Token payload is not valid JSON.');
    }
    const org = (claims as { org?: unknown }).org;
    if (typeof org !== 'string' || org.length === 0) {
      throw new TokenUnverifiedError('Token has no org claim.');
    }
    return { org };
  }
}

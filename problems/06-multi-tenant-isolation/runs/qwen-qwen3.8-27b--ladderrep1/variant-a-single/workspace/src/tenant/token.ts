import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppException } from '../common/app-exception.js';

// ASSUMPTION: Auth tokens are HS256 JWT-like tokens signed with JWT_SECRET and carry the tenant id in `org`.
export interface AuthTokenPayload {
  org: string;
  sub?: string;
  exp?: number;
}

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppException(500, 'auth_secret_missing', 'JWT_SECRET is not configured', {});
  }
  return secret;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  const secret = requireSecret();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${encodedPayload}`).digest('base64url');
  return `${header}.${encodedPayload}.${signature}`;
}

export function verifyAuthToken(authorization: string | undefined): AuthTokenPayload {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    throw new AppException(401, 'unauthorized', 'A bearer token is required', {});
  }

  const token = authorization.slice(7);
  const [header, encodedPayload, signature] = token.split('.');
  if (!header || !encodedPayload || !signature) {
    throw new AppException(401, 'invalid_token', 'Token is malformed', {});
  }

  const secret = requireSecret();
  const expectedSignature = createHmac('sha256', secret).update(`${header}.${encodedPayload}`).digest();
  const providedSignature = Buffer.from(signature, 'base64url');

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new AppException(401, 'invalid_token', 'Token signature is invalid', {});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new AppException(401, 'invalid_token', 'Token payload is not valid JSON', {});
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as AuthTokenPayload).org !== 'string' ||
    (parsed as AuthTokenPayload).org.length === 0
  ) {
    throw new AppException(401, 'invalid_token', 'Token is missing the org claim', {});
  }

  const payload = parsed as AuthTokenPayload;

  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new AppException(401, 'token_expired', 'Token has expired', {});
  }

  return payload;
}

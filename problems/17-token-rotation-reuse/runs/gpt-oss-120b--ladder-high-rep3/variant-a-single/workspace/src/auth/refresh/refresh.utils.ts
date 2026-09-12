import { randomBytes, createHash } from 'crypto';

export function generateRandomToken(): string {
  // 48 bytes => 64 URL‑safe characters
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/**
 * Minimal stand-in for the access-token issuer that already exists in this
 * codebase (`issueAccessToken(userId): string`). Tokens are opaque;
 * verification on protected routes is out of scope here.
 */
@Injectable()
export class AccessTokenService {
  issueAccessToken(userId: string): string {
    return `at_${userId}_${randomBytes(16).toString('base64url')}`;
  }
}

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class TokenIssuerService {
  /**
   * ASSUMPTION: Provided by the existing sign-in system.
   * Issues a short-lived access token for the given user.
   */
  issueAccessToken(userId: string): string {
    return `access_${randomBytes(16).toString('hex')}_${userId}`;
  }
}

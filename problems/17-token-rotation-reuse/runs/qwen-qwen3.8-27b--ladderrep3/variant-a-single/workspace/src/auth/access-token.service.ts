import { Injectable } from '@nestjs/common';

// ASSUMPTION: access-token issuance belongs to the existing sign-in feature and
// its only contract is `issueAccessToken(userId): string`; this stand-in makes
// the rotation module self-contained while that implementation is injected in
// the full app.
@Injectable()
export class AccessTokenService {
  issueAccessToken(userId: string): string {
    return `access:${userId}`;
  }
}

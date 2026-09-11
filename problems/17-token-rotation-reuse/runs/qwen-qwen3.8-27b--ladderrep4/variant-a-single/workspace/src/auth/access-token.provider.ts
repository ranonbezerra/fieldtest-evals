import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/** DI token so the service depends on the contract, not the stand-in. */
export const ACCESS_TOKEN_ISSUER = 'ACCESS_TOKEN_ISSUER';

/** The contract rotation needs from the access-token subsystem. */
export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}

// ASSUMPTION: the real issueAccessToken lives in the existing sign-in /
// access-token verification subsystem. This stand-in issues opaque random
// tokens; point ACCESS_TOKEN_ISSUER at the real issuer on integration.
@Injectable()
export class StubAccessTokenIssuer implements AccessTokenIssuer {
  issueAccessToken(userId: string): string {
    void userId; // opaque on purpose: no claims, no structure to probe
    return `at_${randomBytes(24).toString('base64url')}`;
  }
}

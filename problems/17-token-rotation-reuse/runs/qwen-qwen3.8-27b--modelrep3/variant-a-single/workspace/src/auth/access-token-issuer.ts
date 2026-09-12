// ASSUMPTION: `issueAccessToken(userId): string` is part of the pre-existing
// sign-in infrastructure, which is not included in this change. Only its shape
// is declared here; the concrete provider is registered in `AuthModule` (a
// stand-in until the real issuer is wired in) and tests inject a
// deterministic implementation.
export const ACCESS_TOKEN_ISSUER = 'ACCESS_TOKEN_ISSUER';

export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}

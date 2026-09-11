export interface TokenVerificationResult {
  /** The `org` claim of the verified token. */
  org: string;
}

/**
 * Verifies a raw auth token (signature, expiry, issuer) and returns its
 * claims. Throws on any failure to verify. The middleware never accepts
 * an unverified token.
 */
export interface TokenVerifier {
  verify(token: string): Promise<TokenVerificationResult>;
}

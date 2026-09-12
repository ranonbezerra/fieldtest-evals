/**
 * ASSUMPTION: A utility that creates a signed JWT access token.
 * The implementation is out of scope for this task; we only need the signature.
 */
export function issueAccessToken(userId: string): string {
  // Placeholder – in a real system this would sign a JWT.
  return `access-${userId}-${Date.now()}`;
}

/**
 * Placeholder implementation of an access‑token issuer.
 *
 * In the real codebase this function would create a signed JWT (or similar)
 * containing the user's identifier and any other required claims.
 *
 * @param userId The identifier of the user for whom the token is issued.
 * @returns A string representing the access token.
 */
export function issueAccessToken(userId: string): string {
  // Simple deterministic token for the purpose of the exercise.
  return `access-${userId}-${Date.now()}`;
}

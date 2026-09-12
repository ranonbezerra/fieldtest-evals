// Placeholder implementation for access token issuance.
// ASSUMPTION: In the real system this would generate a signed JWT.
export function issueAccessToken(userId: number): string {
  return `access-token-for-${userId}`;
}

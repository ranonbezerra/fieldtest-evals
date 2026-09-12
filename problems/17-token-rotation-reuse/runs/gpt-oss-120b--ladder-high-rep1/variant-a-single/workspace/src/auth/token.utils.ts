// ASSUMPTION: The real implementation of issueAccessToken exists elsewhere.
// This stub provides a compile‑time placeholder.
export function issueAccessToken(userId: string): string {
  // In a production system this would sign a JWT or similar.
  return `access-token-${userId}-${Date.now()}`;
}

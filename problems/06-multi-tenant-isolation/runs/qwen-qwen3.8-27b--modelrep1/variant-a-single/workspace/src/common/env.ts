/**
 * All runtime configuration comes from environment variables (see
 * .env.example). Access is lazy so tests can set variables before the
 * application is constructed.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export function httpPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined) {
    return 3000;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

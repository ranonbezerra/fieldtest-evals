export class NotFoundError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export class ConflictError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/**
 * Postgres surfaces constraint violations as errors carrying the SQLSTATE in
 * `code`. 23505 is a unique violation (Prisma used to report it as P2002).
 * Prisma's P2025 ("update matched no rows") has no SQLSTATE: Drizzle's update
 * simply resolves with an empty array, so callers check for null instead of
 * relying on this mapper. Anything else propagates as a 500.
 */
export function mapDbError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  if (code === '23505') return new ConflictError('invoice_number_taken');
  return e instanceof Error ? e : new Error(String(e));
}

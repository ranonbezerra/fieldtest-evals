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
 * Drizzle surfaces Postgres errors from the driver; the underlying server
 * error (carrying its SQLSTATE `code`) is either the thrown value itself or
 * nested under `cause`, depending on the driver. 23505 is unique_violation
 * (the former Prisma P2002). The former P2025 ("record not found" from an
 * update that matched nothing) has no Drizzle equivalent: a 0-row update
 * returns no rows, and callers branch on that (see BillingService.issue).
 * Anything else propagates as a 500, as before.
 */
export function mapDbError(e: unknown): Error {
  const codes: string[] = [];
  let current: unknown = e;
  for (let depth = 0; current !== null && typeof current === 'object' && depth < 10; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  if (codes.includes('23505')) return new ConflictError('invoice_number_taken');
  return e instanceof Error ? e : new Error(String(e));
}

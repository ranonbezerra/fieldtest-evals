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
 * Postgres surfaces a unique-constraint violation as an error carrying the
 * SQLSTATE `23505` (unique_violation) on `.code`, whichever driver is in use —
 * the Drizzle counterpart of Prisma's P2002.
 *
 * The P2025 case ("update matched nothing") no longer arrives as an error:
 * Drizzle's update resolves with zero rows, and the repository converts that
 * into a NotFoundError itself, which this mapper passes through untouched.
 * Anything else propagates as a 500.
 */
export function mapDbError(e: unknown): Error {
  if (e instanceof NotFoundError || e instanceof ConflictError) return e;
  const code = (e as { code?: string })?.code;
  if (code === '23505') return new ConflictError('invoice_number_taken');
  return e instanceof Error ? e : new Error(String(e));
}

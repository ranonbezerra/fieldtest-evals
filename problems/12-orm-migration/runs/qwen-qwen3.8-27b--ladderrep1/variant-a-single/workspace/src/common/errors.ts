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
 * Thrown by the data layer when an UPDATE matched no row -- the case Prisma
 * reported as P2025. `resource` names the missing row kind so the mapper can
 * build the same `*_not_found` codes as before.
 */
export class RowNotFoundError extends Error {
  constructor(public readonly resource: string) {
    super(`update matched no ${resource} row`);
    this.name = 'RowNotFoundError';
  }
}

/**
 * Maps data-layer failures to API errors.
 *
 * Drizzle/postgres surface the Postgres SQLSTATE on the thrown error: 23505
 * is a unique-constraint violation (the old P2002 case), and a
 * RowNotFoundError is the old P2025 case. Anything else propagates as a 500,
 * exactly as the old mapper did.
 */
export function mapDbError(e: unknown): Error {
  if (e instanceof RowNotFoundError) {
    return new NotFoundError(`${e.resource}_not_found`);
  }
  const code = (e as { code?: string })?.code;
  if (code === '23505') return new ConflictError('invoice_number_taken');
  return e instanceof Error ? e : new Error(String(e));
}

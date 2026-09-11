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
 * Raised by the data layer when an update matched no row — the situation the
 * old ORM used to report as its "record not found" update error (P2025).
 */
export class RowNotFoundError extends Error {
  constructor(public readonly table: string) {
    super(`no ${table} row matched the update`);
  }
}

/**
 * Postgres surfaces a unique constraint violation as a driver error whose
 * `code` is SQLSTATE 23505 (unique_violation) — the Drizzle-era equivalent of
 * the old P2002. Anything else propagates as a 500.
 */
export function mapDbError(e: unknown): Error {
  if (e instanceof RowNotFoundError) return new NotFoundError('invoice_not_found');
  const code = (e as { code?: string })?.code;
  if (code === '23505') return new ConflictError('invoice_number_taken');
  return e instanceof Error ? e : new Error(String(e));
}

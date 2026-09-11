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
 * Thrown by the billing client when an UPDATE/DELETE matched no row. Postgres
 * performs a no-op UPDATE silently; the Prisma client used to surface this case
 * as P2025. Synthesising a typed error here keeps the service's 404 behaviour
 * identical.
 */
export class RecordNotFoundError extends Error {
  constructor(
    readonly table: string,
    readonly where: Record<string, unknown>,
  ) {
    super(`record not found in ${table}: ${JSON.stringify(where)}`);
  }
}

/**
 * Maps database errors to the API's error types.
 * - 23505 (unique_violation) -> ConflictError('invoice_number_taken')   [was P2002]
 * - RecordNotFoundError      -> NotFoundError('invoice_not_found')      [was P2025]
 * - anything else propagates as-is (500).
 */
export function mapDbError(e: unknown): Error {
  if (e instanceof RecordNotFoundError) return new NotFoundError('invoice_not_found');
  const code = (e as { code?: string })?.code;
  if (code === '23505') return new ConflictError('invoice_number_taken');
  return e instanceof Error ? e : new Error(String(e));
}

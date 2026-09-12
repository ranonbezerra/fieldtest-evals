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
 * Drizzle (Postgres) surfaces constraint violations as errors with a `code` field.
 * 23505 is a unique violation; we map it to `invoice_number_taken`.
 * P2025 is a synthetic code we attach for "record not found" to preserve the
 * existing error contract used by callers of `BillingService.issue`.
 */
export function mapDbError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  if (code === '23505') return new ConflictError('invoice_number_taken');
  if (code === 'P2025') return new NotFoundError('invoice_not_found');
  return e instanceof Error ? e : new Error(String(e));
}

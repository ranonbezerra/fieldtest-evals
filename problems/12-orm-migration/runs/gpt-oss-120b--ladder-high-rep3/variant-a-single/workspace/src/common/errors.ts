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
 * Maps database‑specific error codes to domain errors.
 *
 * - PostgreSQL unique‑violation: `23505` → ConflictError (invoice_number_taken)
 * - Prisma/P2025‑style not‑found: `P2025` → NotFoundError (invoice_not_found)
 * - Prisma unique‑violation: `P2002` (kept for backward compatibility)
 *
 * Any other error is propagated unchanged.
 */
export function mapPrismaError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  if (code === 'P2002' || code === '23505') return new ConflictError('invoice_number_taken');
  if (code === 'P2025') return new NotFoundError('invoice_not_found');
  return e instanceof Error ? e : new Error(String(e));
}

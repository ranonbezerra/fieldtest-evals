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
 * Maps database errors to domain errors.
 *
 * Handles both Prisma-like error codes (if any are thrown) and PostgreSQL
 * error codes returned by Drizzle.
 */
export function mapDbError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  // Prisma unique violation
  if (code === 'P2002') return new ConflictError('invoice_number_taken');
  // Prisma record not found
  if (code === 'P2025') return new NotFoundError('invoice_not_found');
  // PostgreSQL unique violation
  if (code === '23505') return new ConflictError('invoice_number_taken');
  // Add other mappings as needed
  return e instanceof Error ? e : new Error(String(e));
}

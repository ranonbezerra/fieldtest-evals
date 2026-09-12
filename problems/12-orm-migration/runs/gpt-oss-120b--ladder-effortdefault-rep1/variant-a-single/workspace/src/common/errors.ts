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
 * Prisma surfaces constraint violations as `PrismaClientKnownRequestError` with a
 * `code` field. P2002 is a unique violation; P2025 is "record not found" from an
 * update/delete that matched nothing. Anything else propagates as a 500.
 */
export function mapPrismaError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  if (code === 'P2002') return new ConflictError('invoice_number_taken');
  if (code === 'P2025') return new NotFoundError('invoice_not_found');
  return e instanceof Error ? e : new Error(String(e));
}

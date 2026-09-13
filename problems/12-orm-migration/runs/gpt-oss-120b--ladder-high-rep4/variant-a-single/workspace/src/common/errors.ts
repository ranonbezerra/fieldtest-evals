import { ConflictError, NotFoundError } from './errors.js';

/**
 * Maps database‑specific error codes to the domain‑specific error classes used
 * by the service layer.
 *
 * The mapper now understands both the original Prisma error codes (`P2002`,
 * `P2025`) and PostgreSQL's native error codes that Drizzle surfaces (`23505`,
 * `23503`, …).  Unrecognised errors are re‑thrown unchanged.
 */
export function mapPrismaError(e: unknown): Error {
  const code = (e as { code?: string })?.code;

  // Prisma unique‑constraint violation.
  if (code === 'P2002') return new ConflictError('invoice_number_taken');
  // Prisma "record not found".
  if (code === 'P2025') return new NotFoundError('invoice_not_found');

  // PostgreSQL native unique‑constraint violation (23505).
  if (code === '23505') return new ConflictError('invoice_number_taken');
  // PostgreSQL foreign‑key / not‑found on update (23503) – treat as not‑found.
  if (code === '23503') return new NotFoundError('invoice_not_found');

  return e instanceof Error ? e : new Error(String(e));
}

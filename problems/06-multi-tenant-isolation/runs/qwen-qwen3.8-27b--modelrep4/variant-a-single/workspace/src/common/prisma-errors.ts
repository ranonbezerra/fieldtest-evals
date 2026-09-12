import { Prisma } from '@prisma/client';

/** True when Prisma reports a unique constraint violation (P2002). */
export function isPrismaUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** True when Prisma reports that no record matched (P2025). */
export function isPrismaMissingRecord(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** True when Prisma reports a blocked foreign key (P2003). */
export function isPrismaForeignKeyViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

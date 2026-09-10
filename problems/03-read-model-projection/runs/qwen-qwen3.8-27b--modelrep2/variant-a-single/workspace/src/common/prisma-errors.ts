import { Prisma } from '@prisma/client';

/** True when the error is a Prisma foreign-key violation (unknown referenced row). */
export function isForeignKeyError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

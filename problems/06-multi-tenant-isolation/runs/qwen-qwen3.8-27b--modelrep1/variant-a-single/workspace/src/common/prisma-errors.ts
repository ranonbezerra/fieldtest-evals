import { Prisma } from '@prisma/client';
import { AppError } from './app-error.js';

/**
 * Converts Prisma known-request errors into AppErrors carrying the
 * error-envelope contract. Unknown errors pass through untouched.
 */
export function fromPrismaError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const metaTarget = error.meta?.target;
        const target = Array.isArray(metaTarget)
          ? metaTarget.map(String).join(', ')
          : 'unique value';
        return new AppError(
          409,
          'conflict',
          `A record with the same ${target} already exists for this tenant`,
          { target },
        );
      }
      case 'P2025':
        return new AppError(404, 'resource_not_found', 'The requested record does not exist for this tenant');
      case 'P2003':
        return new AppError(409, 'conflict', 'A referenced record does not exist for this tenant');
      default:
        return error;
    }
  }
  return error;
}

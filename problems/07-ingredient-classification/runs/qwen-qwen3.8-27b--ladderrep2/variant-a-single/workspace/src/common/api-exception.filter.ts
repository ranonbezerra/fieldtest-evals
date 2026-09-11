import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

/** Maps every thrown value to the single error envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    if (status >= 500) {
      console.error('Unhandled exception:', exception);
    }
    response.status(status).json({ error: { code, message, details } });
  }

  private describe(exception: unknown): { status: number; code: string; message: string; details: Record<string, unknown> } {
    if (exception instanceof ApiError) {
      return { status: exception.status, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return { status: 404, code: 'resource_not_found', message: 'The requested record does not exist.', details: {} };
      }
      if (exception.code === 'P2002') {
        const fields = (exception.meta?.fields ?? {}) as Record<string, string>;
        return { status: 409, code: 'conflict', message: 'A uniqueness constraint was violated.', details: { fields } };
      }
      return { status: 409, code: 'conflict', message: 'A database constraint was violated.', details: { prismaCode: exception.code } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 404
          ? 'resource_not_found'
          : status === 409
            ? 'conflict'
            : status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY
              ? 'validation_error'
              : 'request_rejected';
      return { status, code, message: exception.message, details: {} };
    }
    return { status: 500, code: 'internal_error', message: 'An unexpected error occurred.', details: {} };
  }
}

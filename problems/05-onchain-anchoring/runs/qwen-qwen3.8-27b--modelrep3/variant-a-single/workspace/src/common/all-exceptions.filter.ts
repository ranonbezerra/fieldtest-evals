import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/** Every failure leaves the process as the single envelope { error: { code, message, details } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse() as Response;
    const { status, code, message, details } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception), 'unhandled error');
    }
    const body: ErrorEnvelope = { error: { code, message, details } };
    res.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; code: string; message: string; details: Record<string, unknown> } {
    if (exception instanceof ApiError) {
      return { status: exception.status, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: 409,
          code: 'conflict',
          message: 'resource already exists',
          details: { prismaCode: exception.code, target: exception.meta?.target ?? 'unknown' },
        };
      }
      return { status: 500, code: 'database_error', message: 'database error', details: { prismaCode: exception.code } };
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : exception.message;
      return { status: exception.getStatus(), code: 'http_error', message, details: {} };
    }
    return { status: 500, code: 'internal_error', message: 'unexpected server error', details: {} };
  }
}

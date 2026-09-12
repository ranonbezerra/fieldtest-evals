import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * The single error envelope for the whole API:
 * { "error": { "code": "...", "message": "...", "details": { ... } } }
 * `code` is the snake_case contract; `details` is an object, never null.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      this.logger.error(`error after headers were sent: ${exception instanceof Error ? exception.message : String(exception)}`);
      return;
    }
    const { status, code, message, details } = this.describe(exception);
    if (status >= 500) this.logger.error(`${code}: ${message}`);
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
          message: 'a row with the same unique key already exists',
          details: { target: (exception.meta?.target as string[] | undefined) ?? [] },
        };
      }
      return { status: 500, code: 'database_error', message: exception.message, details: { prismaCode: exception.code } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? 'resource_not_found' : status === 400 ? 'invalid_request' : 'request_rejected';
      return { status, code, message: exception.message, details: {} };
    }
    const err = exception instanceof Error ? exception : undefined;
    return { status: 500, code: 'internal_error', message: err?.message ?? 'unexpected error', details: {} };
  }
}

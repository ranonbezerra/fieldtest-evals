import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

function envelope(code: string, message: string, details: Record<string, unknown>): ErrorEnvelope {
  return { error: { code, message, details } };
}

/** Single error envelope for every failure: { error: { code, message, details } }. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse() as unknown as {
      status(code: number): { json(body: ErrorEnvelope): void };
    };
    const { status, body } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ErrorEnvelope } {
    if (exception instanceof ApiError) {
      return { status: exception.httpStatus, body: envelope(exception.code, exception.message, exception.details) };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: 409,
          body: envelope('conflict', 'A conflicting record already exists.', { prisma_code: exception.code }),
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: 404,
          body: envelope('resource_not_found', 'The requested record does not exist.', { prisma_code: exception.code }),
        };
      }
      return {
        status: 400,
        body: envelope('database_error', 'The database rejected the operation.', { prisma_code: exception.code }),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const rawMessage = typeof payload === 'string' ? payload : (payload as { message?: unknown }).message;
      const message = typeof rawMessage === 'string' ? rawMessage : `HTTP ${status} error.`;
      const code =
        status === 404
          ? 'resource_not_found'
          : status === 400
            ? 'validation_failed'
            : status === 409
              ? 'conflict'
              : status === 401
                ? 'unauthorized'
                : status === 403
                  ? 'forbidden'
                  : status === 405
                    ? 'method_not_allowed'
                    : 'http_error';
      return { status, body: envelope(code, message, {}) };
    }
    return { status: 500, body: envelope('internal_error', 'Unexpected server error.', {}) };
  }
}

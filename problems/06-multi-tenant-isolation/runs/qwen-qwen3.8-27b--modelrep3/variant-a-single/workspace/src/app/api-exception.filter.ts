import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (isApiEnvelope(body)) {
        response.status(status).json(body);
        return;
      }

      response.status(status).json({
        error: {
          code: statusCodeToCode(status),
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    const known = exception as { code?: unknown; meta?: { target?: unknown } } | null;
    if (
      known &&
      typeof known === 'object' &&
      typeof known.code === 'string' &&
      known.code.startsWith('P2')
    ) {
      if (known.code === 'P2002') {
        response.status(409).json({
          error: {
            code: 'duplicate_resource',
            message: 'A resource with these unique values already exists.',
            details: { target: (known.meta?.target as Record<string, unknown>) ?? {} },
          },
        });
        return;
      }

      if (known.code === 'P2025') {
        response.status(404).json({
          error: {
            code: 'resource_not_found',
            message: 'Resource not found.',
            details: {},
          },
        });
        return;
      }
    }

    this.logger.error(`Unhandled error on ${request.method} ${request.url}`, (exception as Error)?.stack);
    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}

function statusCodeToCode(status: number): string {
  if (status === 400) return 'validation_error';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'resource_not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'unprocessable_entity';
  if (status >= 500) return 'internal_error';
  return 'http_error';
}

function isApiEnvelope(
  value: unknown,
): value is { error: { code: string; message: string; details: Record<string, unknown> } } {
  if (value === null || typeof value !== 'object') return false;

  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;

  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    candidate.details !== null &&
    typeof candidate.details === 'object'
  );
}

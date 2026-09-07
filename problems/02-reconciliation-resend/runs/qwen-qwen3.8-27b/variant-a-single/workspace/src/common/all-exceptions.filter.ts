import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const CODES_BY_STATUS: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'invalid_input',
};

function isEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = (body as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return false;
  const error = candidate as Record<string, unknown>;
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.details === 'object' &&
    error.details !== null
  );
}

function extractMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }
  return exception.message;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (isEnvelope(body)) {
        response.status(status).json(body);
        return;
      }
      response.status(status).json({
        error: {
          code: CODES_BY_STATUS[status] ?? 'request_failed',
          message: extractMessage(exception),
          details: {},
        },
      });
      return;
    }

    this.logger.error(`unhandled exception: ${exception instanceof Error ? exception.stack : String(exception)}`);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'unexpected internal error', details: {} },
    });
  }
}

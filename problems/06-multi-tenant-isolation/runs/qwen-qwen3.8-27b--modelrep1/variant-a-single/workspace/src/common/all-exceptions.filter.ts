import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error.js';

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

function toEnvelope(code: string, message: string, details: Record<string, unknown> = {}): ErrorEnvelope {
  return { error: { code, message, details } };
}

/**
 * Answers with the single error envelope. Used by code paths that respond
 * directly (the tenant resolution middleware) instead of throwing.
 */
export function sendError(res: Response, error: AppError): void {
  res.status(error.status).json(toEnvelope(error.code, error.message, error.details));
}

function mapHttpStatus(status: number): { code: string; message: string } {
  switch (status) {
    case 400:
      return { code: 'validation_failed', message: 'Request validation failed' };
    case 401:
      return { code: 'unauthorized', message: 'Authentication is required' };
    case 403:
      return { code: 'forbidden', message: 'Access to this resource is forbidden' };
    case 404:
      return { code: 'resource_not_found', message: 'Resource not found' };
    case 409:
      return { code: 'conflict', message: 'Resource conflict' };
    default:
      return { code: 'http_error', message: `Request failed with status ${status}` };
  }
}

/**
 * Every error leaving the API - thrown AppErrors, Nest HttpExceptions or
 * anything unhandled - is serialized into the one envelope shape.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      return;
    }

    let status = 500;
    let code = 'internal_error';
    let message = 'Unexpected server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      ({ code, message } = mapHttpStatus(status));
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const { message: maybeIssues } = body as { message?: unknown };
        if (Array.isArray(maybeIssues)) {
          details = { issues: maybeIssues };
        }
      }
    }

    if (status >= 500) {
      console.error(exception);
    }

    res.status(status).json(toEnvelope(code, message, details));
  }
}

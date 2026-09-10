import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AppError } from './app-error.js';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

type Envelope = {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
};

/**
 * Single error envelope for the whole API:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const envelope = this.toEnvelope(exception);
    res.status(envelope.status).json({
      error: { code: envelope.code, message: envelope.message, details: envelope.details },
    } satisfies ErrorEnvelope);
  }

  private toEnvelope(exception: unknown): Envelope {
    if (exception instanceof AppError) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return {
          status: 404,
          code: 'resource_not_found',
          message: 'The record does not exist.',
          details: { prismaCode: exception.code },
        };
      }
      return {
        status: 409,
        code: 'invalid_state',
        message: 'The write conflicts with the current database state.',
        details: { prismaCode: exception.code },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return { status, code: this.codeForStatus(status), message: response, details: {} };
      }
      if (typeof response === 'object' && response !== null && 'message' in response) {
        const issues = (response as { message: unknown }).message;
        return {
          status,
          code: 'validation_failed',
          message: 'Request validation failed.',
          details: { issues: Array.isArray(issues) ? issues : [issues] },
        };
      }
      return { status, code: this.codeForStatus(status), message: 'The request could not be processed.', details: {} };
    }
    return { status: 500, code: 'internal_error', message: 'An unexpected error occurred.', details: {} };
  }

  private codeForStatus(status: number): string {
    if (status === 400 || status === 422) return 'validation_failed';
    if (status === 404) return 'resource_not_found';
    if (status === 409) return 'invalid_state';
    return 'request_failed';
  }
}

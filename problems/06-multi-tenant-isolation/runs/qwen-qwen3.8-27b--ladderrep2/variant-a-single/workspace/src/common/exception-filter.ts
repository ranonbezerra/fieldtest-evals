import { Prisma } from '@prisma/client';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { TenantScopeRefusedError } from '../tenant/tenant-scope.util.js';
import { TenantContextError } from '../tenant/tenant-context.util.js';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The single error envelope of the API:
 * { "error": { "code", "message", "details" } }
 * `code` is the snake_case contract; `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toEnvelope(exception);
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    if (exception instanceof TenantContextError) {
      return this.envelope(
        500,
        'tenant_context_missing',
        'A query ran without a resolved tenant and was refused',
        {},
      );
    }
    if (exception instanceof TenantScopeRefusedError) {
      return this.envelope(500, 'tenant_scope_refused', exception.message, {});
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      // Rejections already shaped as the envelope (middleware, validation)
      // pass through untouched.
      if (this.isEnvelope(payload)) {
        return { status, body: payload };
      }
      const message =
        typeof payload === 'string'
          ? payload
          : isRecord(payload) && typeof payload.message === 'string'
            ? payload.message
            : exception.message;
      return this.envelope(status, CODE_BY_STATUS[status] ?? 'request_error', message, {});
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const meta = isRecord(exception.meta) ? exception.meta : {};
        return this.envelope(409, 'conflict', 'A record with the same unique value already exists', {
          target: meta.target,
        });
      }
      if (exception.code === 'P2025') {
        return this.envelope(404, 'resource_not_found', 'The record does not exist', {});
      }
      return this.envelope(500, 'database_error', 'The database request failed', {
        prismaCode: exception.code,
      });
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return this.envelope(500, 'database_error', 'The query was rejected by the ORM', {
        message: exception.message,
      });
    }
    if (exception instanceof Error) {
      return this.envelope(500, 'internal_error', exception.message, {});
    }
    return this.envelope(500, 'internal_error', 'Unexpected error', {});
  }

  private isEnvelope(payload: unknown): payload is ErrorEnvelope {
    return (
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.code === 'string' &&
      typeof payload.error.message === 'string' &&
      isRecord(payload.error.details)
    );
  }

  private envelope(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ): { status: number; body: ErrorEnvelope } {
    return { status, body: { error: { code, message, details } } };
  }
}

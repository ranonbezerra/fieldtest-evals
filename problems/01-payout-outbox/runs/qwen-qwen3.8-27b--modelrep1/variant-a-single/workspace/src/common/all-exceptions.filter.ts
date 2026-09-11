import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ServiceError } from './service-error.js';

/**
 * Global filter that renders every error as the single error envelope:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ServiceError) {
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({
          error: { code: 'resource_not_found', message: 'the requested resource does not exist', details: {} },
        });
        return;
      }
      if (exception.code === 'P2002') {
        res.status(HttpStatus.CONFLICT).json({
          error: { code: 'idempotency_conflict', message: 'a resource with this idempotency key already exists', details: {} },
        });
        return;
      }
      this.logger.error(`unhandled Prisma error (${exception.code})`, exception.message);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === HttpStatus.BAD_REQUEST
          ? 'validation_failed'
          : status === HttpStatus.NOT_FOUND
            ? 'resource_not_found'
            : status === HttpStatus.CONFLICT
              ? 'conflict'
              : 'http_error';
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : String((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({ error: { code, message, details: {} } });
      return;
    } else {
      this.logger.error('unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'an unexpected error occurred', details: {} },
    });
  }
}

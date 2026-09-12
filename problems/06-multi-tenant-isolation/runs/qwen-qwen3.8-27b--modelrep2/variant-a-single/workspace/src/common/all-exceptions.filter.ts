import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AppError, errorEnvelope } from './app-error.js';

/**
 * Renders every unhandled exception as the single error envelope:
 * { "error": { "code", "message", "details" } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      this.send(res, exception.status, exception.code, exception.message, exception.details);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta as { target?: unknown } | null | undefined)?.target;
        this.send(res, 409, 'already_exists', 'A record with the same unique value already exists in this tenant.', {
          target: target ?? [],
        });
        return;
      }
      if (exception.code === 'P2025') {
        this.send(res, 404, 'resource_not_found', 'The requested record does not exist in this tenant.');
        return;
      }
      this.send(res, 500, 'database_error', 'A known database error occurred.', {
        prismaCode: exception.code,
      });
      return;
    }

    console.error('Unhandled exception:', exception);
    this.send(res, 500, 'internal_error', 'An unexpected error occurred.');
  }

  private send(
    res: Response,
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ): void {
    if (res.headersSent) return;
    res.status(status).json(errorEnvelope(code, message, details));
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { AppException } from './exceptions.js';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_input',
  404: 'resource_not_found',
  409: 'conflict',
};

/**
 * Single error envelope for every failure:
 * { "error": { "code": "<snake_case>", "message": "...", "details": {} } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      response.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? (status < 500 ? 'invalid_input' : 'internal_error');
      const rawMessage = exception.message;
      const message = Array.isArray(rawMessage) ? rawMessage.join('; ') : String(rawMessage);
      response.status(status).json({ error: { code, message, details: {} } });
      return;
    }

    const message = exception instanceof Error ? exception.message : 'Unexpected error';
    response.status(500).json({ error: { code: 'internal_error', message, details: {} } });
  }
}

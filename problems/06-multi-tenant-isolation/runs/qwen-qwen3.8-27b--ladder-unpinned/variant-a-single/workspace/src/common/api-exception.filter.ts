import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { toApiError } from './api-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = toApiError(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    res.status(status).json({ error: { code, message, details } });
  }
}

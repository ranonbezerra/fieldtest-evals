import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiResult } from './api-result.js';
import { AppError } from './app-error.js';

/**
 * Registered globally in main.ts, so the envelope holds on the error path too.
 * A controller that catches and shapes its own error response is doing this
 * filter's job, and doing it inconsistently.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      res.status(exception.status).json(ApiResult.err(exception));
      return;
    }

    this.log.error(exception);
    res.status(500).json(ApiResult.err(new AppError('internal', 'internal error')));
  }
}

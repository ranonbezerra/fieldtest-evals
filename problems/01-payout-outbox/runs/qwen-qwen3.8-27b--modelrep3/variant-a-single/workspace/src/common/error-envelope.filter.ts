import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AppError } from './app-error.js';

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse() as {
      status(code: number): { json(body: unknown): void };
      json(body: unknown): void;
    };
    const status = this.statusOf(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    response.status(status).json({ error: this.envelopeOf(exception) });
  }

  private statusOf(exception: unknown): number {
    if (exception instanceof AppError) return exception.httpStatus;
    if (exception instanceof HttpException) return exception.getStatus();
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private envelopeOf(exception: unknown): { code: string; message: string; details: Record<string, unknown> } {
    if (exception instanceof AppError) {
      return { code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST) {
      const response = exception.getResponse();
      const raw =
        response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
      const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];
      return {
        code: 'validation_error',
        message: 'The request body failed validation',
        details: { issues },
      };
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? exception.message);
      const code = exception.getStatus() === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'bad_request';
      const details =
        response && typeof response === 'object' && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : {};
      return { code, message, details };
    }
    return { code: 'internal_error', message: 'An unexpected error occurred', details: {} };
  }
}

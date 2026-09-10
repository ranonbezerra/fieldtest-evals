import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError, ErrorCode } from './errors.js';

interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> };
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      this.send(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : (((body as { message?: unknown }).message) ?? exception.message);
      this.send(response, status, this.codeForStatus(status), String(message), {});
      return;
    }

    this.logger.error(`Unhandled exception: ${exception instanceof Error ? exception.stack : String(exception)}`);
    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, 'internal_error', 'Internal server error', {});
  }

  private codeForStatus(status: number): ErrorCode {
    if (status === 404) return 'resource_not_found';
    if (status === 409) return 'conflict';
    if (status >= 400 && status < 500) return 'validation_failed';
    return 'internal_error';
  }

  private send(
    response: Response,
    status: number,
    code: ErrorCode,
    message: string,
    details: Record<string, unknown>,
  ): void {
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * Every error leaves the API in the single envelope
 * { error: { code, message, details } }; details is always an object.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.toEnvelope(exception);
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'unexpected error';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = this.codeForStatus(status);
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : this.messageFromBody(body);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    return { status, body: { error: { code, message, details } } };
  }

  private codeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return 'validation_failed';
    if (status === HttpStatus.NOT_FOUND) return 'resource_not_found';
    if (status === HttpStatus.CONFLICT) return 'conflict';
    return 'http_error';
  }

  private messageFromBody(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return 'request failed';
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { AnchorDomainError } from '../anchor/anchor.types.js';

type Response = {
  status(code: number): Response;
  json(body: unknown): void;
};

/**
 * The single error envelope for the whole API:
 *
 *   { "error": { "code": "snake_case_code", "message": "...", "details": {} } }
 *
 * `code` is the contract, `message` is developer-facing English, and `details`
 * is always an object, never null.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    res.status(status).json({ error: { code, message, details } });
  }

  private describe(exception: unknown): { status: number; code: string; message: string; details: Record<string, unknown> } {
    if (exception instanceof AnchorDomainError) {
      return { status: exception.httpStatus, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : String((response as Record<string, unknown>).message ?? exception.message);
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'invalid_input');
      return { status, code, message, details: {} };
    }
    if (exception instanceof Error) {
      this.logger.error(`unhandled error: ${exception.message}`);
    }
    return { status: 500, code: 'internal_error', message: 'Internal server error', details: {} };
  }
}

const STATUS_CODES: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'invalid_input',
};

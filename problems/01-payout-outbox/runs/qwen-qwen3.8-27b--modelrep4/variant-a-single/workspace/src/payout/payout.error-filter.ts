import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from '@nestjs/common';
import { PayoutError } from './payout.service';

/** Minimal HTTP response surface the filter needs (Express or Fastify). */
interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): unknown;
}

const CODES_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  415: 'unsupported_media_type',
};

/**
 * Global error envelope: every error leaves the API as
 * { "error": { "code", "message", "details" } } with a snake_case code.
 */
@Catch()
@Injectable()
export class PayoutErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PayoutErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();

    let status = 500;
    let code = 'internal_error';
    let message = 'an unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof PayoutError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        code = CODES_BY_STATUS[status] ?? 'unexpected_error';
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        code = typeof record.code === 'string' ? record.code : (CODES_BY_STATUS[status] ?? 'unexpected_error');
        message = typeof record.message === 'string' ? record.message : exception.message;
        details =
          typeof record.details === 'object' && record.details !== null
            ? (record.details as Record<string, unknown>)
            : {};
      }
    } else if (exception instanceof Error) {
      message = 'an unexpected error occurred';
    }

    if (status >= 500) {
      this.logger.error(exception);
    }

    response.status(status).json({ error: { code, message, details } });
  }
}

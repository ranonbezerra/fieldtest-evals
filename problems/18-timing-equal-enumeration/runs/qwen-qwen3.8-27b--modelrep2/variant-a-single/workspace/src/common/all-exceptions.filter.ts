import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'invalid_credentials',
  403: 'forbidden',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'invalid_request',
};

// Whatever the failure, the client only ever sees the one envelope:
// { "error": { "code": "...", "message": "...", "details": {} } }
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error.';
    const details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'request_rejected');
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (Array.isArray(body)) {
        message = body.map(String).join(', ');
      } else if (body !== null && typeof body === 'object') {
        const maybe = (body as Record<string, unknown>).message;
        if (typeof maybe === 'string') {
          message = maybe;
        } else if (Array.isArray(maybe)) {
          message = maybe.map(String).join(', ');
        }
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({ error: { code, message, details } });
  }
}

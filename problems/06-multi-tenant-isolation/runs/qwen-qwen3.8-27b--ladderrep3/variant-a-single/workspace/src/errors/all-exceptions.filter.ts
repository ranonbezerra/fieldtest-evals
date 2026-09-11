import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { decideError } from './error-mapping';

/**
 * The only place HTTP error responses are produced: every error becomes the
 * single envelope { error: { code, message, details } }.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = decideError(exception);

    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(exception);
    }

    if (!response.headersSent) {
      response.status(status).json({ error: { code, message, details } });
    }
  }
}

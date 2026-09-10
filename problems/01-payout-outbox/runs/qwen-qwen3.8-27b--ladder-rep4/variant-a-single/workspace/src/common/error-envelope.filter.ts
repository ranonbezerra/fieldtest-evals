import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { errorEnvelope } from './error-envelope.js';

/**
 * Last-resort safety net: any error not already mapped by the controller is
 * still returned in the single error envelope.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    let status = 500;
    let message = 'Unexpected server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json(errorEnvelope('internal_error', message));
  }
}

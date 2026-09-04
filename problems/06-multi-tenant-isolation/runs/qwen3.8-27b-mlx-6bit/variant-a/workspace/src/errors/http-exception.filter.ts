import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppException } from './app-exception.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof AppException) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      (exception as { code: string }).code === 'P2002'
    ) {
      response.status(409).json({
        error: {
          code: 'conflict',
          message: 'A record with the same unique value already exists.',
          details: {},
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: status === 404 ? 'resource_not_found' : 'validation_error',
          message: exception.message,
          details: {},
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}

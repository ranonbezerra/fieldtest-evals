import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AppError } from './errors.js';

/**
 * Maps any thrown value onto the single error envelope:
 * { "error": { "code": "<snake_case>", "message": "...", "details": {} } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const appError = this.toAppError(exception);
    const status = appError.getStatus();

    response.status(status).json({
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
    });
  }

  private toAppError(err: unknown): AppError {
    if (err instanceof AppError) {
      return err;
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const message = this.extractMessage(err);
      const code = this.mapStatusToCode(status);
      return new AppError(code, message, status, {});
    }
    return new AppError(
      'invalid_input',
      'An unexpected error occurred.',
      HttpStatus.INTERNAL_SERVER_ERROR,
      {},
    );
  }

  private extractMessage(err: HttpException): string {
    const res = err.getResponse();
    if (typeof res === 'string') {
      return res;
    }
    if (typeof res === 'object' && res !== null) {
      const obj = res as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        return obj.message;
      }
      if (Array.isArray(obj.message)) {
        return (obj.message as string[]).join(', ');
      }
    }
    return err.message;
  }

  private mapStatusToCode(status: number): AppError['code'] {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'invalid_input';
      case HttpStatus.NOT_FOUND:
        return 'resource_not_found';
      case HttpStatus.CONFLICT:
        return 'duplicate_resource';
      case HttpStatus.FORBIDDEN:
      case HttpStatus.UNAUTHORIZED:
        return 'invalid_state';
      default:
        return 'invalid_input';
    }
  }
}

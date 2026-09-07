import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;

      const res = exception.getResponse();
      if (typeof res === 'string') {
        code = this.httpStatusToCode(status);
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        if (typeof body['code'] === 'string') {
          code = body['code'] as string;
        } else {
          code = this.httpStatusToCode(status);
        }
        if (typeof body['details'] === 'object' && body['details'] !== null) {
          details = body['details'] as Record<string, unknown>;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status} - ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const envelope: ErrorEnvelope = {
      error: { code, message, details },
    };

    response.status(status).json(envelope);
  }

  private httpStatusToCode(status: number): string {
    switch (status) {
      case 400:
        return 'bad_request';
      case 401:
        return 'unauthorized';
      case 403:
        return 'forbidden';
      case 404:
        return 'resource_not_found';
      case 409:
        return 'conflict';
      case 422:
        return 'unprocessable_entity';
      case 429:
        return 'too_many_requests';
      default:
        return 'internal_error';
    }
  }
}

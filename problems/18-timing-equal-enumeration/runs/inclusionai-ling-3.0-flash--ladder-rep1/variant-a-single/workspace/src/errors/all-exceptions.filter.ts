import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  async catch(exception: HttpException, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const ex = exception.getResponse();

    let message: string;
    if (typeof ex === 'string') {
      message = ex;
    } else if (Array.isArray(ex)) {
      message = 'Validation failed';
    } else {
      const obj = ex as Record<string, unknown>;
      message = (obj.message as string) || 'Unknown error';
    }

    response.status(status).json({
      error: {
        code: this.mapCode(status),
        message,
        details: {},
      },
    });
  }

  private mapCode(status: number): string {
    switch (status) {
      case 400:
        return 'validation_error';
      case 401:
        return 'invalid_credentials';
      case 404:
        return 'resource_not_found';
      default:
        return 'request_failed';
    }
  }
}

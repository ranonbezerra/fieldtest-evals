import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse() as { status: (s: number) => { json: (d: unknown) => void }; json: (d: unknown) => void };

    const envelope = this.toEnvelope(exception);
    response.status(envelope.status).json(envelope.payload);
  }

  private toEnvelope(exception: unknown): { status: number; payload: ErrorEnvelope } {
    if (exception instanceof KnownError) {
      return {
        status: exception.status,
        payload: {
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details ?? {},
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : (res as Record<string, unknown>).message ?? 'bad_request';
      return {
        status: exception.getStatus(),
        payload: {
          error: {
            code: 'bad_request',
            message: String(message),
            details: {},
          },
        },
      };
    }

    return {
      status: 500,
      payload: {
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred',
          details: {},
        },
      },
    };
  }
}

export class KnownError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.message = message;
    this.status = status;
    this.details = details;
  }
}

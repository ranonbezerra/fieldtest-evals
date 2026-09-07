import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ApiException } from './api-exception.js';

interface HttpOutput {
  status(code: number): HttpOutput;
  json(body: unknown): void;
}

/**
 * Single error envelope for the whole API:
 * { "error": { "code": "snake_case_code", "message": "...", "details": {} } }
 * `code` is the contract; `message` is developer-facing English; `details` is
 * an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpOutput>();
    const { code, message, details, status } = describeException(exception);
    response.status(status).json({ error: { code, message, details } });
  }
}

function describeException(exception: unknown): {
  code: string;
  message: string;
  details: Record<string, unknown>;
  status: number;
} {
  if (exception instanceof ApiException) {
    return { code: exception.code, message: exception.message, details: exception.details, status: exception.status };
  }
  return {
    code: 'internal_error',
    message: exception instanceof Error ? exception.message : 'Unexpected error',
    details: {},
    status: 500,
  };
}

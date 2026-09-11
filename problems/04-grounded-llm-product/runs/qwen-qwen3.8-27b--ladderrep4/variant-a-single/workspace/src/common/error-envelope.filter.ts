import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

const CODES_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'invalid_request',
  429: 'rate_limited',
  500: 'internal_error',
};

function httpMessage(response: unknown): string | undefined {
  if (typeof response === 'string') return response;
  if (typeof response !== 'object' || response === null) return undefined;
  const message = (response as Record<string, unknown>).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return undefined;
}

function toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const message = httpMessage(exception.getResponse()) ?? exception.message;
    return {
      status,
      body: { error: { code: CODES_BY_STATUS[status] ?? 'http_error', message, details: {} } },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'internal_error',
        message: exception instanceof Error ? exception.message : 'unexpected error',
        details: {},
      },
    },
  };
}

/** The single error envelope every failed response uses: { error: { code, message, details } }. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse() as unknown as HttpReply;
    const { status, body } = toEnvelope(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json(body);
  }
}

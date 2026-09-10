import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DomainError } from './common/domain-error.js';

/**
 * The single error envelope for the whole API:
 *   { "error": { "code": "<snake_case>", "message": "...", "details": {} } }
 * `code` is the contract; `message` is developer-facing English;
 * `details` is an object, never null.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ExpressLikeResponse>();
    const { status, code, message, details } = this.classify(exception);
    if (status >= 500) {
      this.logger.error(
        `unhandled error: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
      );
    }
    response.status(status).json({ error: { code, message, details } });
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { status, code: codeForStatus(status), message: payload, details: {} };
      }
      const body = payload as Record<string, unknown>;
      const message =
        typeof body.message === 'string'
          ? body.message
          : Array.isArray(body.message)
            ? (body.message as unknown[]).map(String).join('; ')
            : exception.message;
      return { status, code: codeForStatus(status), message, details: body };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: exception instanceof Error ? exception.message : 'Unexpected error',
      details: { name: exception instanceof Error ? exception.name : 'Unknown' },
    };
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'invalid_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'resource_not_found';
    case 409:
      return 'already_anchored';
    default:
      return 'http_error';
  }
}

interface ExpressLikeResponse {
  status(code: number): { json(body: unknown): unknown };
}

/** Wires global validation and the single error envelope. Shared by the server and the tests. */
export function configureApi(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApi(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`report-anchoring API listening on :${port}`, 'Bootstrap');
}

// Runs only when this file is the entry point (tests import configureApi from here).
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void bootstrap();
}

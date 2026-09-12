import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Every error in the API uses a single envelope:
 * { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `code` is the stable contract, `message` is developer-facing English, and
 * `details` is always an object (never null).
 */
export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    readonly message: string,
    status: HttpStatus,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
  }
}

export class BadRequestError extends ApiError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class ProductNotFoundError extends ApiError {
  constructor(productId: string) {
    super('product_not_found', `Product "${productId}" was not found.`, HttpStatus.NOT_FOUND, {
      product_id: productId,
    });
  }
}

export class ProfileNotFoundError extends ApiError {
  constructor(profileId: string) {
    super('profile_not_found', `Family profile "${profileId}" was not found.`, HttpStatus.NOT_FOUND, {
      profile_id: profileId,
    });
  }
}

export class MethodologyVersionNotFoundError extends ApiError {
  constructor(methodologyVersionId: string) {
    super(
      'methodology_version_not_found',
      `Methodology version "${methodologyVersionId}" was not found.`,
      HttpStatus.NOT_FOUND,
      { methodology_version_id: methodologyVersionId },
    );
  }
}

export class NoActiveMethodologyError extends ApiError {
  constructor() {
    super(
      'no_active_methodology',
      'No methodology version is active; publish one before classifying.',
      HttpStatus.CONFLICT,
      {},
    );
  }
}

export class MethodologyVersionExistsError extends ApiError {
  constructor(code: string) {
    super('methodology_version_exists', `Methodology version "${code}" is already published.`, HttpStatus.CONFLICT, {
      code,
    });
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

@Catch()
export class ApiEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse() as {
      status(code: number): { json(body: unknown): void };
    };

    if (exception instanceof ApiError) {
      const envelope: ErrorEnvelope = {
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
      response.status(exception.getStatus()).json(envelope);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        response.status(status).json({ error: { code: 'http_error', message: payload, details: { http_status: status } } });
        return;
      }
      const body = payload as Record<string, unknown>;
      const code = typeof body.code === 'string' ? body.code : 'http_error';
      const message =
        typeof body.message === 'string'
          ? body.message
          : Array.isArray(body.message)
            ? body.message.join('; ')
            : `HTTP ${status}`;
      const details = body.details && typeof body.details === 'object' ? (body.details as Record<string, unknown>) : {};
      response.status(status).json({ error: { code, message, details } });
      return;
    }

    // eslint-disable-next-line no-console
    console.error('Unhandled exception:', exception);
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'internal_error', message: 'Unexpected server error.', details: {} } });
  }
}

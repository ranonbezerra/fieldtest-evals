import { HttpException } from '@nestjs/common';

/**
 * Base class for application errors. `code` is the snake_case contract
 * consumed by clients; `message` is developer-facing English; `details`
 * is always a plain object.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}

export class ResourceNotFoundException extends AppException {
  constructor(resource: string, details: Record<string, unknown> = {}) {
    super(404, 'resource_not_found', `The requested ${resource} was not found.`, details);
  }
}

export class InvalidInputException extends AppException {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, 'invalid_input', message, details);
  }
}

export class AlreadyExistsException extends AppException {
  constructor(resource: string, details: Record<string, unknown> = {}) {
    super(409, 'already_exists', `A ${resource} with this value already exists.`, details);
  }
}

export class NoActiveMethodologyException extends AppException {
  constructor() {
    super(
      409,
      'no_active_methodology',
      'No methodology version has been published yet; publish one before classifying.',
    );
  }
}

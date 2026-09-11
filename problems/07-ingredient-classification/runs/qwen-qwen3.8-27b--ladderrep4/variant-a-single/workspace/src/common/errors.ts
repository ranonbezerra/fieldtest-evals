export type ErrorCode =
  | 'resource_not_found'
  | 'invalid_request'
  | 'no_active_methodology'
  | 'duplicate_version'
  | 'internal_error';

/** Base class for all domain errors; serialized into the single error envelope. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends AppError {
  constructor(resource: string, id: string, extra: Record<string, unknown> = {}) {
    super('resource_not_found', 404, `${resource} '${id}' was not found.`, { resource, id, ...extra });
  }
}

export class InvalidRequestError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('invalid_request', 400, message, details);
  }
}

export class NoActiveMethodologyError extends AppError {
  constructor() {
    super('no_active_methodology', 409, 'No methodology version is published; publish one before classifying.', {});
  }
}

export class DuplicateVersionError extends AppError {
  constructor(version: number) {
    super('duplicate_version', 409, `Methodology version ${version} already exists.`, { version });
  }
}

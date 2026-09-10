import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application error mapped 1:1 to the API error envelope:
 * { "error": { "code", "message", "details" } }.
 * `code` is the stable snake_case contract; `message` is developer-facing
 * English; `details` is always an object.
 */
export class ApiError extends HttpException {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, status: number, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.message = message;
    this.code = code;
    this.details = details;
  }

  static invalidRequest(message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('invalid_request', HttpStatus.BAD_REQUEST, message, details);
  }

  static notFound(message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('resource_not_found', HttpStatus.NOT_FOUND, message, details);
  }

  static conflict(message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('conflict', HttpStatus.CONFLICT, message, details);
  }

  static internal(message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('internal_error', HttpStatus.INTERNAL_SERVER_ERROR, message, details);
  }
}

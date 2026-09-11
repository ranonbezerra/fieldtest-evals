import { HttpException } from '@nestjs/common';

/**
 * All domain errors extend this. The global filter maps them to the
 * one error envelope; the code is derived from the exception name.
 */
export class AppError extends HttpException {
  constructor(message: string, status: number) {
    super(message, status);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message: string) {
    super(message, 401);
  }
}

export class TenantMismatchError extends AppError {
  constructor(message: string) {
    super(message, 403);
  }
}

export class ResourceNotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

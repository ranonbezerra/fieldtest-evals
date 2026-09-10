import { HttpException } from '@nestjs/common';

/**
 * Application error carrying the stable `snake_case` code from the error
 * envelope contract. `message` is developer-facing English; `details` is
 * always an object (possibly empty).
 */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}

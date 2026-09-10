import { HttpException } from '@nestjs/common';

/**
 * Application error that carries the single error envelope contract:
 * { "error": { "code": "snake_case", "message": "...", "details": {} } }.
 */
export class ApiError extends HttpException {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, statusCode);
  }
}

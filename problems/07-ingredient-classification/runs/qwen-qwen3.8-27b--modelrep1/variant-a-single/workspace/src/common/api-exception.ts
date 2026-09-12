import { HttpException } from '@nestjs/common';

/**
 * Application-level error carrying a stable snake_case code. The global
 * exception filter serializes it into the single error envelope:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 */
export class ApiException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
  }
}

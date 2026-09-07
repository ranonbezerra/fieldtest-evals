import { HttpException } from '@nestjs/common';

export class AppException extends HttpException {
  readonly code: string;
  readonly developerMessage: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    developerMessage: string,
    details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message: developerMessage, details } }, status);
    this.code = code;
    this.developerMessage = developerMessage;
    this.details = details;
  }
}

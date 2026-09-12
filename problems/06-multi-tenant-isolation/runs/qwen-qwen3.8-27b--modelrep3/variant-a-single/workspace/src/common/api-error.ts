import { HttpException } from '@nestjs/common';

export class ApiError extends HttpException {
  readonly code: string;
  readonly details: Record<string, unknown>;
  private readonly errorMessage: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.errorMessage = message;
    this.details = details;
  }

  getResponse(): {
    error: { code: string; message: string; details: Record<string, unknown> };
  } {
    return {
      error: {
        code: this.code,
        message: this.errorMessage,
        details: this.details,
      },
    };
  }
}

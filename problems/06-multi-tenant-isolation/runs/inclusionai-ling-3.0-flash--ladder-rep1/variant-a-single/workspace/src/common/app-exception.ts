import { HttpException } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number = 400,
  ) {
    super(
      {
        error: {
          code,
          message,
          details: {},
        },
      },
      status,
    );
  }
}

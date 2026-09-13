import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    code: string,
    message: string,
    details: Record<string, any> = {},
    status: number = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        error: {
          code,
          message,
          details,
        },
      },
      status,
    );
  }
}

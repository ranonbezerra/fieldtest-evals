import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(
    code: string,
    message: string,
    details: any = {},
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ error: { code, message, details } }, status);
  }
}

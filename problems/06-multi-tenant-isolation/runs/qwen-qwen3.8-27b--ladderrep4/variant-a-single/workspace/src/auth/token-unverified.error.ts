import { HttpException } from '@nestjs/common';

export class TokenUnverifiedError extends HttpException {
  constructor(message: string) {
    super(message, 401);
  }
}

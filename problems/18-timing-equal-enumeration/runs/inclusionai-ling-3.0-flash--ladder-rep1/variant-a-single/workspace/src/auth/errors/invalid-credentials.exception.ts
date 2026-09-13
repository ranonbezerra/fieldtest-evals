import { HttpException } from '@nestjs/common';

export class InvalidCredentialsException extends HttpException {
  constructor() {
    super({ message: 'Invalid credentials.' }, 401);
  }
}

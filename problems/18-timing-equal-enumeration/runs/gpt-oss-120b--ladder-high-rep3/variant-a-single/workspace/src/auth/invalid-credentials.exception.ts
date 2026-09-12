import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidCredentialsException extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'invalid_credentials',
          message: 'Invalid email or password',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

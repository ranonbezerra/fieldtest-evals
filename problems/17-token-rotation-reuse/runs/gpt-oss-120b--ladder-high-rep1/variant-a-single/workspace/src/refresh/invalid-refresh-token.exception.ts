import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidRefreshTokenException extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'invalid_refresh_token',
          message: 'Invalid refresh token',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

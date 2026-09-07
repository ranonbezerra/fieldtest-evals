import { HttpException, HttpStatus } from '@nestjs/common';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export class Errors {
  static notFound(resource: string, details: Record<string, unknown> = {}): HttpException {
    const body: ErrorBody = {
      error: {
        code: 'resource_not_found',
        message: `${resource} not found.`,
        details,
      },
    };
    return new HttpException(body, HttpStatus.NOT_FOUND);
  }

  static invalidState(message: string): HttpException {
    const body: ErrorBody = {
      error: {
        code: 'invalid_state',
        message,
        details: {},
      },
    };
    return new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

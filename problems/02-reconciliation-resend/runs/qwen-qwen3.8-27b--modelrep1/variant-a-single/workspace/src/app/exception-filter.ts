import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}

const CODE_BY_STATUS = new Map<number, string>([
  [HttpStatus.NOT_FOUND, 'resource_not_found'],
  [HttpStatus.CONFLICT, 'conflict'],
  [HttpStatus.UNAUTHORIZED, 'unauthorized'],
  [HttpStatus.FORBIDDEN, 'forbidden'],
  [HttpStatus.BAD_REQUEST, 'validation_failed'],
]);

/** Single error envelope: { error: { code, message, details } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof Error ? exception.message : 'unexpected error';
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      console.error(exception);
    }
    host.switchToHttp().getResponse<HttpResponseLike>().status(status).json({
      error: {
        code: CODE_BY_STATUS.get(status) ?? (status >= 500 ? 'internal_error' : 'request_failed'),
        message,
        details: {},
      },
    });
  }
}

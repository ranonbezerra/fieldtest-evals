import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Response } from '@nestjs/common';

@Catch(HttpException)
export class ErrorFormatFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const responseBody = exception.getResponse();

    let body: any;
    if (typeof responseBody === 'object' && responseBody !== null && 'error' in responseBody) {
      body = responseBody;
    } else {
      body = {
        error: {
          code: 'internal_error',
          message: typeof responseBody === 'string' ? responseBody : 'Internal server error',
          details: {},
        },
      };
    }

    (response as any).status(exception.getStatus()).json(body);
  }
}

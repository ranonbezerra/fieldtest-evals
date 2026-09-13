import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { AuthFailedException } from './auth.failed.exception.js';

@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}

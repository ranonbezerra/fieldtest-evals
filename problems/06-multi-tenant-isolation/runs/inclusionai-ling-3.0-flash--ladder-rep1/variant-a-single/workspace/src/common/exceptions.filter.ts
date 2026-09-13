import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof Error && exception.message === 'No tenant in context') {
      response.status(500).json({
        error: {
          code: 'no_tenant_context',
          message: 'No tenant context available for this request',
          details: {},
        },
      });
      return;
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException ? exception.message : 'Internal server error';
    const code = this.mapCode(exception);

    response.status(status).json({
      error: {
        code,
        message,
        details: {},
      },
    });
  }

  private mapCode(exception: unknown): string {
    if (exception instanceof NotFoundException) return 'resource_not_found';
    if (exception instanceof BadRequestException) return 'bad_request';
    if (exception instanceof UnauthorizedException) return 'unauthorized';
    if (exception instanceof HttpException) return (exception as any).message?.code ?? 'unknown_error';
    return 'internal_error';
  }
}

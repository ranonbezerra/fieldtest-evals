import { NestFactory } from '@nestjs/core';
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ResourceNotFound, ConflictError } from './classification/types.js';

@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let status: number;
    let code: string;
    let message: string;

    if (exception instanceof ResourceNotFound) {
      status = 404;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof ConflictError) {
      status = 409;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = 'http_error';
      message = exception.message;
    } else {
      status = 500;
      code = 'internal_error';
      message = 'An unexpected error occurred';
    }

    response.status(status).json({
      error: {
        code,
        message,
        details: {},
      },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(3000);
}

void bootstrap();

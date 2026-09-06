import { NestFactory } from '@nestjs/core';
import {
  ValidationPipe,
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { AppModule } from './app.module';
import { AuthFailureError } from './auth/auth.service';

@Catch()
class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let status: number;
    let code: string;
    let message: string;

    if (exception instanceof AuthFailureError) {
      status = 401;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const rec = body as Record<string, unknown>;
        if (rec.message) {
          message = Array.isArray(rec.message)
            ? rec.message.join(', ')
            : String(rec.message);
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }
      code = status === 400 ? 'validation_failed' : 'error';
    } else {
      status = 500;
      code = 'internal_error';
      message = 'Internal server error.';
    }

    response.status(status).json({
      error: { code, message, details: {} },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();

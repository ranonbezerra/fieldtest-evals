import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EnvelopeExceptionFilter } from './common/exception.filter';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

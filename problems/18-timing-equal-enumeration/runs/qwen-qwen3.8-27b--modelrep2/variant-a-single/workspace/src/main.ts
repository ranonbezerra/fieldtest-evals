import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Input validation lives on the controller DTOs; anything unknown is stripped.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Every failure leaves the process in the single error envelope.
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
}

void bootstrap();

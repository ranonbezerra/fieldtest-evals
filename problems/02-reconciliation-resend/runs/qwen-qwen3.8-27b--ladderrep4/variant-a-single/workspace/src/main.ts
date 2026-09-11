import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from './common/exception-filter.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT !== undefined ? Number.parseInt(process.env.PORT, 10) : 3000;
  await app.listen(Number.isInteger(port) && port > 0 ? port : 3000);
}

void bootstrap();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './app/api-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(Number.isFinite(port) ? port : 3000);
}

void bootstrap();

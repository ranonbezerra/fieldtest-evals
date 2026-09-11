import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/api-error.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

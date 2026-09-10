import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ApiErrorFilter } from './common/api-error.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiErrorFilter());
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { applyGlobalAppConfig } from './common/app-config.js';
import { httpPort } from './common/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  applyGlobalAppConfig(app);
  app.enableShutdownHooks();
  await app.listen(httpPort());
}

void bootstrap();

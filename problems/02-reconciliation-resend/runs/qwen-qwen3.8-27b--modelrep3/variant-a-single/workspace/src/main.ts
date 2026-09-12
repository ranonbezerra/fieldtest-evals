import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

// Worker process: this app has no HTTP surface. The payout processor's timer keeps
// the event loop alive; init() boots the module graph without listening.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.init();
}

void bootstrap();

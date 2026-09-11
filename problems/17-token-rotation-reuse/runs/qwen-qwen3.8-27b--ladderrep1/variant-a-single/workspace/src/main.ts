import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Deliberately no global ValidationPipe: a malformed refresh token must
  // produce the canonical 401 rejection, not a pipe-generated 400.
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();

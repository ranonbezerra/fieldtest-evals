import 'reflect-metadata';
import { test } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

test('application boots without wiring errors', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  await app.close();
});

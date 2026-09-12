import { describe, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('should initialize without errors', async () => {
    const app = await NestFactory.create(AppModule);
    await app.init();
    await app.close();
  });
});

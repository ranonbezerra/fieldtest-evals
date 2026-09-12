import { describe, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('boots without DI errors', async () => {
    const app = await NestFactory.createApplicationContext(AppModule);
    await app.close();
  });
});

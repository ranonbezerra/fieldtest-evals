import { describe, expect, it } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { ExportService } from '../src/users/export.service.js';
import { UsersModule } from '../src/users/users.module.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';

describe('AppModule wiring', () => {
  it('boots: every provider resolves and cross-module providers are exported', async () => {
    const app: INestApplication = await NestFactory.create(AppModule, {
      logger: false,
    });
    try {
      await app.init();

      expect(app.get(ExportService)).toBeInstanceOf(ExportService);
      expect(app.get(RetryProcessor)).toBeInstanceOf(RetryProcessor);
    } finally {
      await app.close();
    }
  });

  it('fails when a provider is used across a module boundary without being exported', async () => {
    @Injectable()
    class ExportProbe {
      constructor(@Inject(ExportService) private readonly exports: ExportService) {}
    }

    @Module({
      imports: [UsersModule],
      providers: [ExportProbe],
    })
    class ExportProbeModule {}

    const app: INestApplication = await NestFactory.create(ExportProbeModule, {
      logger: false,
    });
    try {
      await expect(app.init()).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});

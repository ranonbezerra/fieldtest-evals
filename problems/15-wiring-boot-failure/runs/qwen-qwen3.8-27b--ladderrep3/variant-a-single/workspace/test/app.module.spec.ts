import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ExportService } from '../src/users/export.service.js';
import { DeliveryRepository } from '../src/notifications/delivery.repository.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';

/**
 * Boot-failure regression check: builds the real application context with the
 * same call `src/main.ts` makes, using the real providers — no fakes.
 *
 * This is the evaluation the faked-repository unit suite never performs. On
 * the broken wiring it fails in two distinct ways:
 *
 * 1. with the jobs ⇄ notifications import cycle, importing `AppModule`
 *    crashes at module-evaluation time (Temporal Dead Zone) before any test
 *    code runs;
 * 2. with a provider missing from its owner's `providers`/`exports`,
 *    `NestFactory.create` rejects with "Nest can't resolve dependencies".
 *
 * A passing typecheck is green in every one of those states, which is why
 * this check has to exist.
 */
describe('AppModule wiring', () => {
  it('resolves every provider across every module boundary', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      expect(app.get<ExportService>(ExportService)).toBeInstanceOf(ExportService);
      expect(app.get<NotificationsService>(NotificationsService)).toBeInstanceOf(NotificationsService);
      expect(app.get<DeliveryRepository>(DeliveryRepository)).toBeInstanceOf(DeliveryRepository);
      expect(app.get<RetryProcessor>(RetryProcessor)).toBeInstanceOf(RetryProcessor);

      const job = await app.get<ExportService>(ExportService).enqueue('wiring');
      expect(job).toEqual({ id: 'exp_wiring_0', rows: 0 });

      const handled = await app.get<RetryProcessor>(RetryProcessor).sweep();
      expect(handled).toBe(0);
    } finally {
      await app.close();
    }
  }, 15_000);
});

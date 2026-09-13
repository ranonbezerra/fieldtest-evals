import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DeliveryRepository } from '../src/notifications/delivery.repository.js';
import { ExportsController } from '../src/exports/exports.controller.js';
import { ExportService } from '../src/users/export.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RetryProcessor } from '../src/jobs/retry.processor.js';
import { UsersService } from '../src/users/users.service.js';

describe('Application wiring', () => {
  it('builds the real application context with all providers resolved', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(app.get(NotificationsService)).toBeInstanceOf(NotificationsService);
    expect(app.get(DeliveryRepository)).toBeInstanceOf(DeliveryRepository);
    expect(app.get(ExportService)).toBeInstanceOf(ExportService);
    expect(app.get(UsersService)).toBeInstanceOf(UsersService);
    expect(app.get(RetryProcessor)).toBeInstanceOf(RetryProcessor);
    expect(app.get(ExportsController)).toBeInstanceOf(ExportsController);

    await app.close();
  });

  it('resolves all cross-module provider dependencies', async () => {
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // ExportsController depends on ExportService, which lives in UsersModule.
    const controller = app.get(ExportsController);
    expect(controller).toBeInstanceOf(ExportsController);
    // The injection token is the ExportService instance, not a stub.
    expect(app.get(ExportService)).toBe(app.get(ExportsController).exports);

    // RetryProcessor depends on NotificationsService, which depends on DeliveryRepository.
    const processor = app.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
    expect(processor.notifications).toBe(app.get(NotificationsService));

    await app.close();
  });
});

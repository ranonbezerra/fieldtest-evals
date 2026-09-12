import { test, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { ExportService } from '../src/users/export.service.js';

test('application wiring should resolve core services', async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const notifications = moduleRef.get(NotificationsService);
  const exportSvc = moduleRef.get(ExportService);

  expect(notifications).toBeDefined();
  expect(exportSvc).toBeDefined();
});

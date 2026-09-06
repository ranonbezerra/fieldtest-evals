// ASSUMPTION: `@nestjs/testing` must be installed as a devDependency (pnpm add -D @nestjs/testing).
// ASSUMPTION: `src/export/export.service.ts` must exist for this import to resolve; the plan names it but the file has not yet been created.
// ASSUMPTION: `PrismaService` lives at `src/prisma/prisma.service.ts` per the <feature>/<feature>.service.ts layout convention.

import { Test, type TestModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { ExportService } from '../src/export/export.service.js';
import { RetryProcessor } from '../src/retry/retry.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { QUEUES } from '../src/common/queues.js';

describe('wiring', () => {
  let moduleRef: TestModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();
  });

  it('compiles the full DI graph', () => {
    expect(moduleRef).toBeDefined();
  });

  it('resolves NotificationsService', () => {
    const service = moduleRef.get(NotificationsService);
    expect(service).toBeInstanceOf(NotificationsService);
  });

  it('resolves ExportService in UsersModule context', () => {
    const service = moduleRef.get(ExportService);
    expect(service).toBeInstanceOf(ExportService);
  });

  it('resolves RetryProcessor in NotificationsModule context', () => {
    const processor = moduleRef.get(RetryProcessor);
    expect(processor).toBeInstanceOf(RetryProcessor);
  });

  it('QUEUES is a frozen, importable const', () => {
    expect(QUEUES).toBeFrozen();
    expect(QUEUES.notifications).toBe('notifications');
    expect(QUEUES.retries).toBe('retries');
  });
});

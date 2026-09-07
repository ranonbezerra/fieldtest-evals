import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersModule } from '../src/users/users.module.js';
import { UsersService } from '../src/users/users.service.js';
import { UsersRepository } from '../src/users/users.repository.js';
import { ExportsModule } from '../src/exports/exports.module.js';
import { ExportService } from '../src/exports/exports.service.js';
import { ExportsRepository } from '../src/exports/exports.repository.js';
import { NotificationsModule } from '../src/notifications/notifications.module.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { NotificationsRepository } from '../src/notifications/notifications.repository.js';
import { QueueModule } from '../src/queue/queue.module.js';
import { RetryProcessor } from '../src/queue/retry.processor.js';

function providerTokens(module: Type<unknown>): Array<Type<unknown>> {
  return (Reflect.getMetadata('providers', module) ?? []) as Array<Type<unknown>>;
}

function exportTokens(module: Type<unknown>): Array<Type<unknown>> {
  return (Reflect.getMetadata('exports', module) ?? []) as Array<Type<unknown>>;
}

function importTokens(module: Type<unknown>): Array<Type<unknown>> {
  return (Reflect.getMetadata('imports', module) ?? []) as Array<Type<unknown>>;
}

function hasModuleCycle(modules: readonly Type<unknown>[]): boolean {
  const known = new Set<Type<unknown>>(modules);
  const visiting = new Set<Type<unknown>>();
  const done = new Set<Type<unknown>>();

  const visit = (module: Type<unknown>): boolean => {
    if (done.has(module)) return false;
    if (visiting.has(module)) return true;

    visiting.add(module);
    const dependencies = importTokens(module).filter((token) => known.has(token));
    for (const dependency of dependencies) {
      if (visit(dependency)) return true;
    }

    visiting.delete(module);
    done.add(module);
    return false;
  };

  for (const module of modules) {
    if (visit(module)) return true;
  }

  return false;
}

async function assertResolves(module: Type<unknown>, token: Type<unknown>): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [module] }).compile();
  try {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  } finally {
    await moduleRef.close();
  }
}

describe('DI wiring', () => {
  it('declares and exports providers in the module that owns them', () => {
    expect(importTokens(AppModule)).toContain(UsersModule);
    expect(importTokens(AppModule)).toContain(NotificationsModule);
    expect(importTokens(AppModule)).toContain(QueueModule);

    expect(providerTokens(PrismaModule)).toContain(PrismaService);
    expect(exportTokens(PrismaModule)).toContain(PrismaService);

    expect(providerTokens(UsersModule)).toContain(UsersService);
    expect(providerTokens(UsersModule)).toContain(UsersRepository);
    expect(importTokens(UsersModule)).toContain(PrismaModule);
    expect(importTokens(UsersModule)).toContain(ExportsModule);
    expect(providerTokens(UsersModule)).not.toContain(ExportService);
    expect(providerTokens(UsersModule)).not.toContain(ExportsRepository);

    expect(providerTokens(ExportsModule)).toContain(ExportService);
    expect(providerTokens(ExportsModule)).toContain(ExportsRepository);
    expect(exportTokens(ExportsModule)).toContain(ExportService);
    expect(importTokens(ExportsModule)).toContain(PrismaModule);

    expect(providerTokens(NotificationsModule)).toContain(NotificationsService);
    expect(providerTokens(NotificationsModule)).toContain(NotificationsRepository);
    expect(exportTokens(NotificationsModule)).toContain(NotificationsService);
    expect(importTokens(NotificationsModule)).toContain(PrismaModule);

    expect(providerTokens(QueueModule)).toContain(RetryProcessor);
    expect(importTokens(QueueModule)).toContain(NotificationsModule);
    expect(providerTokens(QueueModule)).not.toContain(NotificationsService);
    expect(providerTokens(QueueModule)).not.toContain(NotificationsRepository);
  });

  it('does not contain a module import cycle', () => {
    const modules = [
      AppModule,
      PrismaModule,
      UsersModule,
      ExportsModule,
      NotificationsModule,
      QueueModule,
    ];
    expect(hasModuleCycle(modules)).toBe(false);
  });

  it('boots the full application module graph', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      expect(moduleRef).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });

  it('resolves each feature through its own module boundary', async () => {
    await assertResolves(PrismaModule, PrismaService);
    await assertResolves(ExportsModule, ExportService);
    await assertResolves(NotificationsModule, NotificationsService);
    await assertResolves(UsersModule, UsersService);
    await assertResolves(QueueModule, RetryProcessor);
  });
});

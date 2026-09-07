import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '../config/config.service.js';
import { ExportService } from '../users/export.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeliveryRepository } from '../notifications/delivery.repository.js';

/**
 * Performs a runtime sanity check that all expected providers are resolvable.
 * If any provider cannot be retrieved, the application will crash during
 * bootstrap, surfacing wiring mistakes that static type‑checking cannot catch.
 */
@Injectable()
export class WiringCheckService implements OnModuleInit {
  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    const tokens = [
      ConfigService,
      PrismaService,
      ExportService,
      NotificationsService,
      DeliveryRepository,
    ];

    for (const token of tokens) {
      const instance = this.moduleRef.get(token, { strict: false });
      if (!instance) {
        throw new Error(`Wiring check failed: could not resolve provider ${token?.name ?? token}`);
      }
    }
  }
}

import { MiddlewareConsumer, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantController } from './tenant.controller.js';
import { TenantMiddleware } from './tenant.middleware.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantController],
  providers: [TenantService, TenantRepository, TenantMiddleware],
  configure(consumer: MiddlewareConsumer): void {
    // Applies to every route: no request may reach a controller without a
    // resolved, agreed-upon tenant.
    consumer.apply(TenantMiddleware);
  },
})
export class TenantModule {}

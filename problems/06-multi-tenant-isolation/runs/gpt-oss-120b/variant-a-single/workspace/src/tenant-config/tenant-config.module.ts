// src/tenant-config/tenant-config.module.ts

import { Module } from '@nestjs/common';

// ASSUMPTION: The following files exist in the same folder and export the
// corresponding classes. They are not part of the current task, so we only
// reference them here.
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigService } from './tenant-config.service';
import { TenantConfigRepository } from './tenant-config.repository';

// ASSUMPTION: A PrismaModule is defined at src/prisma/prisma.module.ts and
// provides the request‑scoped PrismaService used by repositories.
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TenantConfigController],
  providers: [TenantConfigService, TenantConfigRepository],
  exports: [TenantConfigService],
})
export class TenantConfigModule {}

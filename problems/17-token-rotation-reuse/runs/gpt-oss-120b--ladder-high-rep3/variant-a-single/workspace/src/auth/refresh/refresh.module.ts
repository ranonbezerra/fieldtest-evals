import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller.js';
import { RefreshService } from './refresh.service.js';
import { RefreshRepository } from './refresh.repository.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository],
  exports: [RefreshService],
})
export class RefreshModule {}

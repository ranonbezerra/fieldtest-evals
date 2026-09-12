import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller.js';
import { RefreshService } from './refresh.service.js';
import { RefreshRepository } from './refresh.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  imports: [],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository, PrismaService],
  exports: [RefreshService],
})
export class RefreshModule {}

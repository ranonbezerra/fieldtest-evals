import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AnchorController],
  providers: [AnchorService, AnchorRepository, PrismaService],
  exports: [AnchorService],
})
export class AnchorModule {}

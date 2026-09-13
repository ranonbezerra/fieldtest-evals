import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';
import { MethodologyService } from './methodology.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [ClassificationController],
  providers: [
    ClassificationService,
    ClassificationRepository,
    MethodologyService,
    PrismaService,
  ],
  exports: [ClassificationService, MethodologyService],
})
export class ClassificationModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationRepository } from './classification.repository.js';
import { ClassificationService } from './classification.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}

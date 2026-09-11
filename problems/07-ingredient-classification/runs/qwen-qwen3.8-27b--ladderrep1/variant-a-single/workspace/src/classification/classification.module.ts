import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}

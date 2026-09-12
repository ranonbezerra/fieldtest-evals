import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository, PrismaService],
  exports: [ClassificationService],
})
export class ClassificationModule {}

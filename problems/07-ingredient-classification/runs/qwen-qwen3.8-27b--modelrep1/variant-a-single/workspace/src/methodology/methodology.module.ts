import { Module } from '@nestjs/common';
import { ClassificationModule } from '../classification/classification.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MethodologyController } from './methodology.controller.js';
import { MethodologyRepository } from './methodology.repository.js';
import { MethodologyService } from './methodology.service.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
})
export class MethodologyModule {}

import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { DriftRepairService } from './drift-repair.service.js';
import { ReDerivationService } from './re-derivation.service.js';

@Module({
  controllers: [OperationsController],
  providers: [
    PrismaService,
    OperationsService,
    OperationsRepository,
    DriftRepairService,
    ReDerivationService,
  ],
  exports: [OperationsService, DriftRepairService, ReDerivationService],
})
export class OperationsModule {}

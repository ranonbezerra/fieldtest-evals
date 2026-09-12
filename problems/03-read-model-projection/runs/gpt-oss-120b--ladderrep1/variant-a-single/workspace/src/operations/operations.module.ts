import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsRepository } from './operations.repository';
import { PrismaService } from '../prisma.service';
import { DriftRepairJob } from './drift-repair.job';

@Module({
  imports: [],
  controllers: [OperationsController],
  providers: [
    OperationsService,
    OperationsRepository,
    PrismaService,
    DriftRepairJob, // scheduled job
  ],
  exports: [OperationsService],
})
export class OperationsModule {}

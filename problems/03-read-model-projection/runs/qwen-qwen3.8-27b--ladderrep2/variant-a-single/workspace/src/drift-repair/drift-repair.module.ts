import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { DriftRepairJob } from './drift-repair.job';

@Module({
  imports: [OperationsModule],
  providers: [DriftRepairJob],
})
export class DriftRepairModule {}

import { Module } from '@nestjs/common';
import { ProjectionsModule } from '../projections/projections.module';
import { DriftRepairProcessor } from './drift-repair.processor';

@Module({
  imports: [ProjectionsModule],
  providers: [DriftRepairProcessor],
})
export class DriftRepairModule {}

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ProjectionsModule } from '../projections/projections.module';
import { DriftRepairProcessor } from './drift-repair.processor';

@Module({
  imports: [ScheduleModule.forRoot(), ProjectionsModule],
  providers: [DriftRepairProcessor],
})
export class DriftRepairModule {}

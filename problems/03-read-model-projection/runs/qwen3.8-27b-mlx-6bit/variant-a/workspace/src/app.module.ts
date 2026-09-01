import { Module } from '@nestjs/common';
import { OperationsModule } from './operations/operations.module';
import { ProjectionsModule } from './projections/projections.module';
import { WritesModule } from './writes/writes.module';
import { DriftRepairModule } from './drift-repair/drift-repair.module';

@Module({
  imports: [OperationsModule, ProjectionsModule, WritesModule, DriftRepairModule],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { DriftRepairService } from './drift-repair.service.js';

@Module({
  providers: [DriftRepairService],
  exports: [DriftRepairService],
})
export class DriftRepairModule {}

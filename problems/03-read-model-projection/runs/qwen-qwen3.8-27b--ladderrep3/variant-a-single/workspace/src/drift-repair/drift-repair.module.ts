import { Module } from '@nestjs/common';
import { ReDerivationModule } from '../re-derivation/re-derivation.module.js';
import { DriftRepairRepository } from './drift-repair.repository.js';
import { DriftRepairService } from './drift-repair.service.js';

@Module({
  imports: [ReDerivationModule],
  providers: [DriftRepairService, DriftRepairRepository],
})
export class DriftRepairModule {}

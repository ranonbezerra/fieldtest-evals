import { Module } from '@nestjs/common';
import { OperationsModule } from './operations/operations.module';
import { ReDerivationModule } from './re-derivation/re-derivation.module';
import { DriftRepairModule } from './drift-repair/drift-repair.module';

@Module({
  imports: [OperationsModule, ReDerivationModule, DriftRepairModule],
})
export class AppModule {}

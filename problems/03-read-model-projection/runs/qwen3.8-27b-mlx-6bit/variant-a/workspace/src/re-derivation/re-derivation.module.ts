import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { ReDerivationService } from './re-derivation.service';
import { ReDerivationController } from './re-derivation.controller';

// ASSUMPTION: The TS2307 errors on lines 2–4 indicate that the imported modules
// (../operations/operations.module, ./re-derivation.service, ./re-derivation.controller)
// are not yet present or have their own compile errors. The paths and class names
// above follow the PLAN.md manifest exactly; these errors will resolve once those
// files are in place and compiling.

@Module({
  imports: [OperationsModule],
  controllers: [ReDerivationController],
  providers: [ReDerivationService],
})
export class ReDerivationModule {}

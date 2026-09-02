import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { ReDerivationService } from './re-derivation.service';
import { ReDerivationController } from './re-derivation.controller';

@Module({
  imports: [OperationsModule],
  controllers: [ReDerivationController],
  providers: [ReDerivationService],
})
export class ReDerivationModule {}

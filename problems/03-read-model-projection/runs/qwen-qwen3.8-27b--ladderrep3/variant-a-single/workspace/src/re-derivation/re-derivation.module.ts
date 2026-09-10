import { Module } from '@nestjs/common';
import { ReDerivationService } from './re-derivation.service.js';
import { ReDerivationRepository } from './re-derivation.repository.js';

@Module({
  providers: [ReDerivationService, ReDerivationRepository],
  exports: [ReDerivationService],
})
export class ReDerivationModule {}

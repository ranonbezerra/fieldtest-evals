import { Module } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository.js';

@Module({
  providers: [MethodologyRepository],
  exports: [MethodologyRepository],
})
export class MethodologyModule {}

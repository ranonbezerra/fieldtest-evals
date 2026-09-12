import { Module } from '@nestjs/common';
import { AnchoringModule } from './anchoring/anchoring.module.js';

@Module({
  imports: [AnchoringModule],
})
export class AppModule {}

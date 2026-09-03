import { Module } from '@nestjs/common';
import { AnchoringModule } from './anchoring/anchoring.module';

@Module({
  imports: [AnchoringModule],
})
export class AppModule {}

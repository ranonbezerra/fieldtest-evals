import { Module } from '@nestjs/common';
import { ProjectionModule } from '../projection/projection.module.ts';
import { DriftService } from './drift.service.ts';
import { DriftController } from './drift.controller.ts';

@Module({
  imports: [ProjectionModule],
  controllers: [DriftController],
  providers: [DriftService],
})
export class DriftModule {}

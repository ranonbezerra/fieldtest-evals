import { Module } from '@nestjs/common';
import { WiringCheckService } from './wiring-check.service.js';

@Module({
  providers: [WiringCheckService],
})
export class WiringCheckModule {}

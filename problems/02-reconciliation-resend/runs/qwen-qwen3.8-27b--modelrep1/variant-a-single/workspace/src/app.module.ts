import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
})
export class AppModule {}

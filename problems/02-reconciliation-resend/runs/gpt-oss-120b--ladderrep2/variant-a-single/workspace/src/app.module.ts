import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutModule } from './payout/payout.module.js';
import { PayoutScheduler } from './payout/payout.scheduler.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
  controllers: [],
  providers: [PayoutScheduler],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutsModule } from './payouts/payouts.module';

@Module({
  // @nestjs/schedule drives the cron-based payout jobs (see PayoutsJob).
  imports: [ScheduleModule.forRoot(), PayoutsModule],
})
export class AppModule {}

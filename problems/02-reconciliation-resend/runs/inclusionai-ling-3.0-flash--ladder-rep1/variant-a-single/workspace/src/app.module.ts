import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { BankModule } from './bank/bank.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [BankModule, PayoutModule, SchedulerModule],
})
export class AppModule {}

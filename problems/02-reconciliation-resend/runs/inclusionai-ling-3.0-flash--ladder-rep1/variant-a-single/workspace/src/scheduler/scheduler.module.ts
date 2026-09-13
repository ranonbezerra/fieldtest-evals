import { Module } from '@nestjs/common';
import { ReconcileSchedulerService } from './reconcile-scheduler.service';
import { PayoutModule } from '../payout/payout.module';

@Module({
  imports: [PayoutModule],
  providers: [ReconcileSchedulerService],
})
export class SchedulerModule {}

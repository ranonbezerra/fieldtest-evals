import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReconcileService } from './reconcile.service.js';
import { PayoutModule } from '../payout/payout.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
  providers: [ReconcileService],
})
export class ReconcileModule {}

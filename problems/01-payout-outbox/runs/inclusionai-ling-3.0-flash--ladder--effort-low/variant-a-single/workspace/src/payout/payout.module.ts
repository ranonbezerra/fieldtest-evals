import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ProviderModule } from '../provider/provider.module';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';

@Module({
  imports: [CommonModule, ProviderModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker],
})
export class PayoutModule {}

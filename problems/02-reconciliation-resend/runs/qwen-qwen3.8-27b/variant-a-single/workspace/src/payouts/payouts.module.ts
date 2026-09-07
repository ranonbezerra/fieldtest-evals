import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsJob } from './payouts.job';
import { PayoutsRepository } from './payouts.repository';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [BankModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository, PayoutsJob],
  exports: [PayoutsService],
})
export class PayoutsModule {}

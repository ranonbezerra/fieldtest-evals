import { Module } from '@nestjs/common';
import { PayoutModule } from '../payout/payout.module.js';
import { AccountsController } from './accounts.controller.js';
import { PayoutRepository } from '../payout/payout.repository.js';

@Module({
  imports: [PayoutModule],
  controllers: [AccountsController],
  providers: [PayoutRepository],
})
export class AccountsModule {}

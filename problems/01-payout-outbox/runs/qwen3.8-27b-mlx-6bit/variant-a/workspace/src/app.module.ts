import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';
import { OutboxModule } from './outbox/outbox.module.js';

@Module({
  imports: [PayoutModule, OutboxModule],
})
export class AppModule {}

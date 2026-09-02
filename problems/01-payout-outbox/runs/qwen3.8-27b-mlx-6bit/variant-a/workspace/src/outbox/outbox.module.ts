import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OutboxRepository } from './outbox.repository.js';
import { PayoutModule } from '../payout/payout.module.js';

@Module({
  imports: [PayoutModule],
  providers: [OutboxRepository, OutboxService],
})
export class OutboxModule {}

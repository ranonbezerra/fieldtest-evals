import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetryProcessor } from './retry.processor.js';

@Module({
  providers: [RetryProcessor],
  imports: [NotificationsModule],
})
export class QueueModule {}

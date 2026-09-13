import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { QUEUES, QueueName } from './queue.constant.js';
import { RetryProcessor } from './retry.processor.js';

@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}

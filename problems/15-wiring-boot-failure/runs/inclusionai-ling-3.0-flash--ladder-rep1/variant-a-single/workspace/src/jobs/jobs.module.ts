import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetryProcessor } from './retry.processor.js';
import { QUEUES, QueueName } from './queues.js';

export { QUEUES };
export type { QueueName };

@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}

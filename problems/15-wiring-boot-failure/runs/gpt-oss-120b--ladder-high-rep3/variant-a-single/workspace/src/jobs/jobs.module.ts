import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetryProcessor } from './retry.processor.js';
import { QUEUES, QueueName } from './queues.constants.js';

/** Queue names. Imported all over the application. */
export { QUEUES, QueueName };

@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}

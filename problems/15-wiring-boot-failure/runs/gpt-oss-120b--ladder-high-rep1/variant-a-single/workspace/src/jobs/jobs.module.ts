import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RetryProcessor } from './retry.processor.js';

/**
 * The JobsModule imports NotificationsModule to gain access to
 * NotificationsService for the retry processor. The queue constants have been
 * moved to a separate file to break the import cycle.
 */
@Module({
  imports: [NotificationsModule],
  providers: [RetryProcessor],
})
export class JobsModule {}

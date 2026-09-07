import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { QueueModule } from './queue/queue.module.js';

// ASSUMPTION: The exact original module names were not provided; these are the feature names stated in the task.
@Module({
  imports: [UsersModule, NotificationsModule, QueueModule],
})
export class AppModule {}

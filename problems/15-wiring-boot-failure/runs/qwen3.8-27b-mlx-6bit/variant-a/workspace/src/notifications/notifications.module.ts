import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { RetryModule } from '../retry/retry.module.js';

@Module({
  providers: [NotificationsService],
  imports: [RetryModule],
})
export class NotificationsModule {}

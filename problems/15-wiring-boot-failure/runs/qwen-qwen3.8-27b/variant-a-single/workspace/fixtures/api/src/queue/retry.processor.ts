import { Inject, Injectable } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { NotificationRecord } from '../notifications/notifications.service.js';
import { QUEUES } from './queue.constants.js';

@Injectable()
export class RetryProcessor {
  readonly queueName: string = QUEUES.RETRY;

  constructor(
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService,
  ) {}

  processPending(take: number = 10): Promise<NotificationRecord[]> {
    return this.notificationsService.retryPending(take);
  }

  complete(notificationId: string): Promise<NotificationRecord> {
    return this.notificationsService.markRetrySent(notificationId);
  }
}

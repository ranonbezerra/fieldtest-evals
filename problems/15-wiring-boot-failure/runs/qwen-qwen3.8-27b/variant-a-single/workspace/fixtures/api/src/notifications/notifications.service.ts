import { Inject, Injectable } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository.js';
import type { NotificationRecord, SendNotificationInput } from './notifications.repository.js';
import { QUEUES } from '../queue/queue.constants.js';

export type { NotificationRecord, SendNotificationInput } from './notifications.repository.js';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NotificationsRepository) private readonly notificationsRepository: NotificationsRepository,
  ) {}

  send(input: SendNotificationInput): Promise<NotificationRecord> {
    return this.notificationsRepository.create(input);
  }

  retryPending(take: number = 10): Promise<NotificationRecord[]> {
    return this.notificationsRepository.findPending(take);
  }

  markRetrySent(id: string): Promise<NotificationRecord> {
    return this.notificationsRepository.markSent(id);
  }

  retryQueueName(): string {
    return QUEUES.RETRY;
  }
}

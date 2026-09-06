import { Injectable } from '@nestjs/common';
import { QUEUES, QueueName } from '../common/queues.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class RetryProcessor {
  private readonly queue: QueueName = QUEUES.retries;

  constructor(private readonly notificationsService: NotificationsService) {}

  enqueue(payload: unknown): void {
    void this.queue;
  }

  process(item: { original: unknown; error: unknown }): void {
    try {
      this.notificationsService.send(item.original);
    } catch (err) {
      this.enqueue({ original: item.original, error: err });
    }
  }
}

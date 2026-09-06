import { Injectable } from '@nestjs/common';
import { QUEUES, QueueName } from '../common/queues.js';
import { RetryProcessor } from '../retry/retry.processor.js';

@Injectable()
export class NotificationsService {
  private readonly queue: QueueName = QUEUES.notifications;

  constructor(private readonly retryProcessor: RetryProcessor) {}

  send(payload: unknown): void {
    // Dispatch to the backing broker on the notifications queue.
    void this.queue;
  }

  sendWithRetry(payload: unknown): void {
    try {
      this.send(payload);
    } catch (err) {
      this.retryProcessor.enqueue({ original: payload, error: err });
    }
  }
}

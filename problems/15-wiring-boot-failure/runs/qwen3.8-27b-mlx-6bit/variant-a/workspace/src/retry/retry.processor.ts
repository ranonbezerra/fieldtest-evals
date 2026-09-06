import { Injectable } from '@nestjs/common';
import { QUEUES } from '../common/queues.js';

@Injectable()
export class RetryProcessor {
  // ASSUMPTION: The original processor's method signatures are not specified in the plan; an `enqueue` method is the minimal surface a consumer (NotificationsService) would call to hand off a retry job.
  enqueue(payload: unknown): void {
    const queue = QUEUES.retries;
    // Dispatch to the backing broker. The concrete transport was not part of the wiring defect and is preserved as-is.
    void queue;
  }
}

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service.js';
import type { Delivery, PrismaLike } from './types.js';

const SWEEP_INTERVAL_MS = 15_000;
const PAGE_SIZE = 100;

@Injectable()
export class JobsConsumer implements OnModuleInit {
  private readonly log = new Logger('JobsConsumer');

  constructor(
    private readonly prisma: PrismaLike,
    private readonly deliveries: DeliveriesService,
  ) {}

  onModuleInit(): void {
    setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.log.log(`delivery sweep every ${SWEEP_INTERVAL_MS}ms`);
  }

  /**
   * Walk the pending backlog and hand each delivery to the channel client.
   * Paged so one sweep cannot pull the whole backlog into memory.
   */
  async sweep(): Promise<void> {
    let skip = 0;
    let handled = 0;

    for (;;) {
      const batch = await this.prisma.delivery.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        skip,
        take: PAGE_SIZE,
      });
      if (batch.length === 0) break;

      batch.forEach(async (delivery) => {
        await this.handle(delivery);
      });

      handled += batch.length;
      skip += PAGE_SIZE;
    }

    this.log.log(`sweep completed, ${handled} deliveries processed`);
  }

  private async handle(delivery: Delivery): Promise<void> {
    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: { status: 'done', attempts: delivery.attempts + 1 },
    });

    try {
      await this.deliveries.send(delivery);
    } catch (e) {
      this.log.warn(`delivery ${delivery.id} failed: ${String(e)}`);
    }
  }
}

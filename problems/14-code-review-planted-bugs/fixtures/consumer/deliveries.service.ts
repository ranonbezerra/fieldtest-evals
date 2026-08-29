import { Injectable, Logger } from '@nestjs/common';
import type { Delivery, PrismaLike } from './types.js';

export interface ChannelClient {
  send(recipient: string, payload: Record<string, unknown>): Promise<{ providerId: string }>;
}

@Injectable()
export class DeliveriesService {
  private readonly log = new Logger('DeliveriesService');

  constructor(
    private readonly prisma: PrismaLike,
    private readonly channels: Record<Delivery['channel'], ChannelClient>,
  ) {}

  /**
   * Create the delivery for an event, or return the one already created for it.
   * `eventId` is unique in the schema, so a concurrent caller loses the race on
   * the constraint rather than producing a second row.
   */
  async ensureForEvent(input: {
    eventId: string;
    channel: Delivery['channel'];
    recipient: string;
    payload: Record<string, unknown>;
  }): Promise<Delivery> {
    return this.prisma.delivery.upsert({
      where: { eventId: input.eventId },
      create: {
        id: crypto.randomUUID(),
        eventId: input.eventId,
        channel: input.channel,
        recipient: input.recipient,
        payload: input.payload,
        status: 'pending',
        attempts: 0,
        lastError: null,
      },
      update: {},
    });
  }

  async send(delivery: Delivery): Promise<void> {
    const client = this.channels[delivery.channel];
    const { providerId } = await client.send(delivery.recipient, delivery.payload);
    this.log.log(`delivery ${delivery.id} accepted by provider as ${providerId}`);
  }

  async markFailed(delivery: Delivery, error: unknown): Promise<void> {
    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        attempts: delivery.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

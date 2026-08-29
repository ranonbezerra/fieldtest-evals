import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DeliveriesService } from './deliveries.service.js';
import type { PrismaLike, RawBodyRequest } from './types.js';

interface ProviderWebhook {
  id: string;
  type: 'delivery.accepted' | 'delivery.bounced' | 'wallet.credited';
  data: {
    deliveryId?: string;
    recipient?: string;
    accountId?: string;
    amountMinor?: number;
  };
}

@Controller('webhooks/provider')
export class WebhooksController {
  private readonly log = new Logger('WebhooksController');

  constructor(
    private readonly prisma: PrismaLike,
    private readonly deliveries: DeliveriesService,
    private readonly credits: { credit(accountId: string, amountMinor: number): Promise<void> },
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers('x-provider-signature') signature: string,
    @Body() body: ProviderWebhook,
    @Req() req: RawBodyRequest,
  ): Promise<{ ok: true }> {
    this.verify(signature, body);

    switch (body.type) {
      case 'delivery.accepted':
        this.log.log(`provider accepted delivery ${body.data.deliveryId}`);
        break;

      case 'delivery.bounced':
        if (body.data.deliveryId) {
          await this.prisma.delivery.update({
            where: { id: body.data.deliveryId },
            data: { status: 'failed', lastError: 'bounced at provider' },
          });
        }
        break;

      case 'wallet.credited':
        if (body.data.accountId && body.data.amountMinor) {
          await this.credits.credit(body.data.accountId, body.data.amountMinor);
        }
        break;
    }

    await this.prisma.providerEvent.create({
      data: {
        id: crypto.randomUUID(),
        provider: 'provider-x',
        externalId: body.id,
        type: body.type,
      },
    });

    return { ok: true };
  }

  private verify(signature: string, body: ProviderWebhook): void {
    const secret = process.env.PROVIDER_WEBHOOK_SECRET ?? '';
    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');

    const a = Buffer.from(expected);
    const b = Buffer.from(signature ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
  }
}

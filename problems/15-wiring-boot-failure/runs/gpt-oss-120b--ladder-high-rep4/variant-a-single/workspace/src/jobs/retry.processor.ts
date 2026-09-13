import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RetryProcessor {
  private readonly log = new Logger('RetryProcessor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(): Promise<number> {
    const stuck = await this.prisma.delivery.findMany();
    for (const d of stuck) {
      await this.notifications.resend(d.id);
    }
    this.log.log(`retry sweep handled ${stuck.length}`);
    return stuck.length;
  }
}

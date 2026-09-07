import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SendNotificationInput {
  userId: string;
  channel: string;
  payload: Prisma.InputJsonValue;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  channel: string;
  payload: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(input: SendNotificationInput): Promise<NotificationRecord> {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        payload: input.payload,
      },
    });
  }

  findPending(take: number = 10): Promise<NotificationRecord[]> {
    return this.prisma.notification.findMany({
      where: { status: 'pending' },
      take,
    });
  }

  markSent(id: string): Promise<NotificationRecord> {
    return this.prisma.notification.update({
      where: { id },
      data: { status: 'sent' },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { Payout, PrismaClient } from '@prisma/client';

@Injectable()
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<Payout[]> {
    return this.prisma.payout.findMany({ orderBy: { createdAt: 'desc' } });
  }
}

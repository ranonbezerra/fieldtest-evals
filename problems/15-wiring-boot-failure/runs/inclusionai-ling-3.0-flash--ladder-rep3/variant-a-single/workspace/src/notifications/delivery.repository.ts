import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async pending(): Promise<Array<{ id: string; status: string }>> {
    return this.prisma.delivery.findMany();
  }

  async markSent(_id: string): Promise<void> {
    await this.prisma.delivery.update();
  }
}

import { PrismaClient, Order, OrderStatus } from '@prisma/client';

export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(effectiveDate: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, effectiveDate },
    });
  }

  async findInFlight(effectiveDate: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.IN_FLIGHT, effectiveDate },
    });
  }

  async findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { txid },
    });
  }

  async transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    patch?: Partial<Pick<Order, 'attempts' | 'txid'>>,
  ): Promise<boolean> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: from },
      data: { status: to, ...patch },
    });
    return result.count > 0;
  }
}

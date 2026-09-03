import type { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import type { CreateOrderInput, UpdateOrderInput, Order } from './dto.js';

export class OrderRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Order[]> {
    return this.db.order.findMany();
  }

  async findById(id: string): Promise<Order | null> {
    return this.db.order.findUnique({ where: { id } });
  }

  async create(input: CreateOrderInput): Promise<Order> {
    return this.db.order.create({ data: input });
  }

  async update(id: string, input: UpdateOrderInput): Promise<Order> {
    return this.db.order.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.order.delete({ where: { id } });
  }
}

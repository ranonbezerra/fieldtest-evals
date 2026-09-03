import { Injectable } from '@nestjs/common';
import { OrderRepository } from './order.repository.js';
import { CreateOrderInput, UpdateOrderInput, Order } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  async list(): Promise<Order[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Order> {
    const order = await this.repo.findById(id);
    if (!order) {
      throw new ResourceNotFoundError('Order');
    }
    return order;
  }

  async create(input: CreateOrderInput): Promise<Order> {
    try {
      return await this.repo.create(input);
    } catch (err: unknown) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateOrderInput): Promise<Order> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    );
  }
}

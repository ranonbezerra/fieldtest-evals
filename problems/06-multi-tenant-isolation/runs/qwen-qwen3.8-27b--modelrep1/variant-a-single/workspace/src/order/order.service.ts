import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { fromPrismaError } from '../common/prisma-errors.js';
import { CustomerRepository } from '../customer/customer.repository.js';
import { PlanRepository } from '../plan/plan.repository.js';
import { CreateOrderDto, UpdateOrderDto } from './order.dto.js';
import { OrderRepository } from './order.repository.js';

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly customers: CustomerRepository,
    private readonly plans: PlanRepository,
  ) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    const [customer, plan] = await Promise.all([
      this.customers.findById(dto.customerId),
      this.plans.findById(dto.planId),
    ]);
    if (!customer) {
      throw new AppError(404, 'resource_not_found', `Customer ${dto.customerId} was not found for the current tenant`);
    }
    if (!plan) {
      throw new AppError(404, 'resource_not_found', `Plan ${dto.planId} was not found for the current tenant`);
    }
    return this.orders
      .create({ customerId: customer.id, planId: plan.id, status: 'PENDING', totalCents: plan.priceCents })
      .catch((error: unknown) => {
        throw fromPrismaError(error);
      });
  }

  list(): Promise<Order[]> {
    return this.orders.list();
  }

  async get(id: string): Promise<Order> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw new AppError(404, 'resource_not_found', `Order ${id} was not found for the current tenant`);
    }
    return order;
  }

  async update(id: string, dto: UpdateOrderDto): Promise<Order> {
    const result = await this.orders.update(id, { status: dto.status }).catch((error: unknown) => {
      throw fromPrismaError(error);
    });
    if (result.count === 0) {
      throw new AppError(404, 'resource_not_found', `Order ${id} was not found for the current tenant`);
    }
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.orders.delete(id);
    if (result.count === 0) {
      throw new AppError(404, 'resource_not_found', `Order ${id} was not found for the current tenant`);
    }
  }
}

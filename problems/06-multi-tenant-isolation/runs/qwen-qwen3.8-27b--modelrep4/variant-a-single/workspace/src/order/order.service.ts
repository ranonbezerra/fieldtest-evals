import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { CustomerService } from '../customer/customer.service.js';
import { NotFoundError } from '../common/api-error.js';
import { PlanService } from '../plan/plan.service.js';
import { OrderRepository } from './order.repository.js';

export interface OrderCreateInput {
  reference: string;
  customerId: string;
  planId?: string;
  amountCents: number;
  currency?: string;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly customers: CustomerService,
    private readonly plans: PlanService,
  ) {}

  list(): Promise<Order[]> {
    return this.orders.list();
  }

  async get(id: string): Promise<Order> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw new NotFoundError(`Order with id "${id}" was not found in this tenant`);
    }
    return order;
  }

  async create(input: OrderCreateInput): Promise<Order> {
    // The referenced rows must be visible in the current tenant; an id that
    // belongs to another tenant resolves to nothing and therefore 404s.
    await this.customers.get(input.customerId);
    if (input.planId) {
      await this.plans.get(input.planId);
    }
    return this.orders.create(input);
  }
}

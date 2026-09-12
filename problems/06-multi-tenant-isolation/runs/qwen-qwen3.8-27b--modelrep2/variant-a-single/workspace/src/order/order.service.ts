import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerService } from '../customer/customer.service.js';
import { PlanService } from '../plan/plan.service.js';
import { OrderRepository } from './order.repository.js';

export interface CreateOrderInput {
  customerId: string;
  planId: string;
  totalCents?: number;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly customers: CustomerService,
    private readonly plans: PlanService,
  ) {}

  list() {
    return this.orders.list();
  }

  async get(id: string) {
    const order = await this.orders.findById(id);
    if (!order) {
      throw new AppError(404, 'resource_not_found', `Order ${id} was not found for this tenant.`, {
        id,
      });
    }
    return order;
  }

  async create(input: CreateOrderInput) {
    // Both lookups are tenant-scoped, so a cross-tenant reference fails
    // with 404 here instead of becoming a cross-tenant order.
    const [customer, plan] = await Promise.all([
      this.customers.get(input.customerId),
      this.plans.get(input.planId),
    ]);
    return this.orders.create({
      customerId: customer.id,
      planId: plan.id,
      totalCents: input.totalCents ?? plan.priceCents,
    });
  }
}

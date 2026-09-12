import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { bodyOf, optionalString, requireNonNegativeInt, requireString } from '../common/validators.js';
import { OrderService } from './order.service.js';

@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  list(): Promise<Order[]> {
    return this.orders.list();
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<Order> {
    return this.orders.get(id);
  }

  @Post()
  create(@Body() rawBody: unknown): Promise<Order> {
    const body = bodyOf(rawBody);
    const reference = requireString(body, 'reference', { max: 120 });
    const customerId = requireString(body, 'customerId', { max: 64 });
    const amountCents = requireNonNegativeInt(body, 'amountCents');
    const currency = optionalString(body, 'currency', { max: 8 });
    const planId = optionalString(body, 'planId', { max: 64 });
    return this.orders.create({ reference, customerId, amountCents, currency, planId });
  }
}

import { Controller, Get } from '@nestjs/common';
import { OrderView, OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  listOrders(): Promise<OrderView[]> {
    return this.ordersService.listOrders();
  }
}

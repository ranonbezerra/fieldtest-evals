import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { CreateOrderDto } from './create-order.dto';
import { OrderService, OrderView } from './order.service';

@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderView> {
    return this.orders.createOrder({
      companyId: body.companyId,
      workerId: body.workerId,
      eventId: body.eventId,
      amountCents: body.amountCents,
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string): Promise<OrderView> {
    return this.orders.approveOrder(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string): Promise<OrderView> {
    return this.orders.rejectOrder(id);
  }
}

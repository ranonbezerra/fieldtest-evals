import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CreatePaymentOrderDto, TransitionOrderDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('payment-orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(@Body() body: CreatePaymentOrderDto) {
    return this.ordersService.createOrder(body);
  }

  @Patch(':id')
  transitionOrder(@Param('id') id: string, @Body() body: TransitionOrderDto) {
    return this.ordersService.transitionOrder(id, body);
  }
}

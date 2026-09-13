import { Body, Controller, Post, Query, Param, Req, HttpCode } from '@nestjs/common';
import { OrderService } from './order.service.ts';
import { AppError, appErrorResponse } from '../types/app.errors.ts';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @HttpCode(201)
  @Post()
  async create(@Body() body: { companyId: string; workerId: string; amount: number }) {
    try {
      return await this.orderService.createOrder(body);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('internal_error', (err as Error).message, 500);
    }
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    try {
      return await this.orderService.approveOrder(id);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('internal_error', (err as Error).message, 500);
    }
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string) {
    try {
      return await this.orderService.rejectOrder(id);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('internal_error', (err as Error).message, 500);
    }
  }
}

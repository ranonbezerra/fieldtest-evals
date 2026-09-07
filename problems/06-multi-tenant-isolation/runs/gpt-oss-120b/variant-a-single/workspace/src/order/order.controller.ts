// src/order/order.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { OrderService } from './order.service';

// ASSUMPTION: The OrderService implements the methods used below
// (findAll, findOne, create, update, remove). Their exact signatures are not
// visible in the current codebase, so we call them with generic parameters.

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  async findAll() {
    return this.orderService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const order = await this.orderService.findOne(id);
    if (!order) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  @Post()
  async create(@Body() createOrderDto: any) {
    // Using `any` to avoid importing a missing DTO file.
    return this.orderService.create(createOrderDto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateOrderDto: any) {
    // Using `any` to avoid importing a missing DTO file.
    return this.orderService.update(id, updateOrderDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.orderService.remove(id);
  }
}

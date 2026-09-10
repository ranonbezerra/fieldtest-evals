import { Body, Controller, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ORDER_STATUSES, type OrderStatus } from './order-status.js';
import { OrderWritesService } from './order-writes.service.js';

export class CreateOrderDto {
  @IsInt()
  companyId!: number;

  @IsInt()
  eventId!: number;

  @IsInt()
  workerId!: number;

  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'amount must be a non-negative decimal with at most 2 fraction digits',
  })
  amount!: string;

  @IsOptional()
  @IsIn([...ORDER_STATUSES])
  status?: OrderStatus;
}

export class TransitionStatusDto {
  @IsIn([...ORDER_STATUSES])
  status!: OrderStatus;
}

export class RenameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

@Controller()
export class OrderWritesController {
  constructor(private readonly writes: OrderWritesService) {}

  @Post('orders')
  createOrder(@Body() dto: CreateOrderDto) {
    return this.writes.createOrder(dto);
  }

  @Patch('orders/:id/status')
  transitionStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: TransitionStatusDto) {
    return this.writes.transitionStatus(id, dto.status);
  }

  @Patch('events/:id')
  renameEvent(@Param('id', ParseIntPipe) id: number, @Body() dto: RenameDto) {
    return this.writes.renameEvent(id, dto.name);
  }

  @Patch('workers/:id')
  renameWorker(@Param('id', ParseIntPipe) id: number, @Body() dto: RenameDto) {
    return this.writes.renameWorker(id, dto.name);
  }
}

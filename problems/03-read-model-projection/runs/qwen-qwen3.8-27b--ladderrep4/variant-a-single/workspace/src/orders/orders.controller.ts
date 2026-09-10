import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsUUID, Matches } from 'class-validator';
import { AppError } from '../common/app-error.js';
import { OrderService, OrderDto } from './orders.service.js';

export class CreateOrderDto {
  @IsUUID()
  companyId!: string;

  @IsUUID()
  workerId!: string;

  /** Cents as a decimal string; JSON numbers lose precision above 2^53. */
  @Matches(/^\d+$/)
  amountCents!: string;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.createOrder({
      companyId: body.companyId,
      workerId: body.workerId,
      amountCents: parseCents(body.amountCents),
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.orders.getOrder(id);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.orders.approveOrder(id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.orders.rejectOrder(id);
  }
}

/** 18 decimal digits always fit a BIGINT; the regex already guarantees digits only. */
function parseCents(raw: string): bigint {
  if (raw.length > 18) {
    throw new AppError(400, 'validation_failed', '`amountCents` is too large for a BIGINT column.', {
      amountCents: raw,
    });
  }
  return BigInt(raw);
}

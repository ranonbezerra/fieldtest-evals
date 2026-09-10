import { Body, Controller, Param, Post } from '@nestjs/common';
import { PaymentOrder } from '@prisma/client';
import {
  finishValidation,
  parseCurrency,
  parseNonNegativeInt,
  parseUuid,
  requireUuid,
  ValidationErrors,
} from '../common/validation.js';
import { NewOrderInput } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: Record<string, unknown> | undefined): Promise<PaymentOrder> {
    const errors: ValidationErrors = {};
    const input = {
      companyId: parseUuid(body?.companyId, 'companyId', errors),
      workerId: parseUuid(body?.workerId, 'workerId', errors),
      amountCents: parseNonNegativeInt(body?.amountCents, 'amountCents', errors),
      currency: parseCurrency(body?.currency, 'currency', errors),
    };
    finishValidation(errors);
    return this.orders.create(input as NewOrderInput);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.approve(id);
  }

  @Post(':id/dispute')
  dispute(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.dispute(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.cancel(id);
  }

  @Post(':id/assign-worker')
  assignWorker(@Param('id') id: string, @Body() body: Record<string, unknown> | undefined): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    const errors: ValidationErrors = {};
    const workerId = parseUuid(body?.workerId, 'workerId', errors);
    finishValidation(errors);
    return this.orders.assignWorker(id, workerId);
  }
}

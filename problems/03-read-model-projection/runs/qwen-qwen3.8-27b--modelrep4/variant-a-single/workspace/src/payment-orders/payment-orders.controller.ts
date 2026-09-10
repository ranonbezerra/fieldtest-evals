import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { PaymentOrderService } from './payment-orders.service.js';
import { ApiError } from '../common/api-error.js';
import { asBodyObject, optionalString, requiredString } from '../common/validate.js';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly orders: PaymentOrderService) {}

  @Post()
  create(@Body() body: unknown) {
    const b = asBodyObject(body);
    const companyId = requiredString(b, 'companyId');
    const workerId = optionalString(b, 'workerId') ?? null;
    const eventId = optionalString(b, 'eventId') ?? null;
    const amountCents = b.amountCents;
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 0) {
      throw new ApiError(400, 'validation_error', '"amountCents" must be a non-negative integer', {
        field: 'amountCents',
      });
    }
    const currency = optionalString(b, 'currency') ?? 'USD';
    return this.orders.create({ companyId, workerId, eventId, amountCents, currency });
  }

  @Post(':id/status')
  @HttpCode(200)
  changeStatus(@Param('id') id: string, @Body() body: unknown) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ApiError(400, 'validation_error', 'order id is required', { field: 'id' });
    }
    const b = asBodyObject(body);
    const status = requiredString(b, 'status');
    return this.orders.changeStatus(id, status);
  }
}

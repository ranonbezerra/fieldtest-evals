import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { asObject, isUuid, parseAmount } from '../common/validation.js';
import { PaymentOrdersService } from './payment-orders.service.js';

const ORDER_STATUSES: string[] = Object.values(OrderStatus);
const CURRENCY_RE = /^[A-Za-z]{3}$/;

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly service: PaymentOrdersService) {}

  @Post()
  create(@Body() rawBody: unknown) {
    const body = asObject(rawBody);
    const errors: Record<string, string> = {};
    if (!isUuid(body.company_id)) errors.company_id = 'must be a UUID';
    if (!isUuid(body.worker_id)) errors.worker_id = 'must be a UUID';
    const amount = parseAmount(body.amount);
    if (amount === null) errors.amount = 'must be a positive number';
    if (typeof body.currency !== 'string' || !CURRENCY_RE.test(body.currency)) {
      errors.currency = 'must be a 3-letter ISO code';
    }
    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Request body failed validation.', 400, { fields: errors });
    }
    return this.service.create({
      companyId: body.company_id as string,
      workerId: body.worker_id as string,
      amount: amount as Prisma.Decimal,
      currency: (body.currency as string).toUpperCase(),
    });
  }

  @Patch(':id')
  changeStatus(@Param('id') id: string, @Body() rawBody: unknown) {
    const body = asObject(rawBody);
    const errors: Record<string, string> = {};
    if (!isUuid(id)) errors.id = 'must be a UUID';
    if (typeof body.status !== 'string' || !ORDER_STATUSES.includes(body.status)) {
      errors.status = `must be one of: ${ORDER_STATUSES.join(', ')}`;
    }
    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Request failed validation.', 400, { fields: errors });
    }
    return this.service.changeStatus(id, body.status as OrderStatus);
  }
}

import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import type { Payout } from '@prisma/client';
import { PayoutsService } from './payouts.service';
import type { CreatePayoutInput, ExecutePaymentsResult, ReconcileResult, ReconcileWindow } from './payouts.service';

// Postgres INTEGER cap; amounts are in minor units.
const MAX_AMOUNT_MINOR = 2_000_000_000;

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post()
  create(@Body() body: unknown): Promise<Payout> {
    return this.service.createOrder(parseCreatePayoutBody(body));
  }

  @Post('execute-payments')
  executePayments(): Promise<ExecutePaymentsResult> {
    return this.service.executePayments();
  }

  /** Body is optional: { from, to } as ISO-8601 date-times, or absent for the default window. */
  @Post('reconcile-windows')
  reconcile(@Body() body: unknown): Promise<ReconcileResult> {
    if (body === undefined || body === null) return this.service.reconcile();
    if (typeof body !== 'object') invalid('body', 'must be a JSON object');
    const raw = body as Record<string, unknown>;
    const hasFrom = 'from' in raw;
    const hasTo = 'to' in raw;
    if (hasFrom !== hasTo) invalid('body', 'must contain both from and to');
    if (!hasFrom) return this.service.reconcile();
    const window: ReconcileWindow = { from: parseDate(raw.from, 'from'), to: parseDate(raw.to, 'to') };
    return this.service.reconcile(window);
  }
}

function invalid(field: string, message: string): never {
  throw new BadRequestException({
    error: { code: 'invalid_input', message: `${field}: ${message}`, details: { field } },
  });
}

function parseCreatePayoutBody(body: unknown): CreatePayoutInput {
  if (typeof body !== 'object' || body === null) invalid('body', 'must be a JSON object');
  const raw = body as Record<string, unknown>;

  const supplierKey = raw.supplierKey;
  if (typeof supplierKey !== 'string' || supplierKey.trim().length === 0) {
    invalid('supplierKey', 'must be a non-empty string');
  }

  const amountMinor = raw.amountMinor;
  if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor)) {
    invalid('amountMinor', 'must be an integer number of minor units');
  }
  if (amountMinor <= 0) invalid('amountMinor', 'must be positive');
  if (amountMinor > MAX_AMOUNT_MINOR) invalid('amountMinor', `must be at most ${MAX_AMOUNT_MINOR}`);

  const effectiveDate = raw.effectiveDate;
  if (typeof effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    invalid('effectiveDate', 'must be a calendar date in YYYY-MM-DD form');
  }
  const parsed = Date.parse(`${effectiveDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) invalid('effectiveDate', 'must be a real calendar date');

  return {
    supplierKey: supplierKey.trim(),
    amountMinor,
    effectiveDate: new Date(parsed),
  };
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    invalid(field, 'must be an ISO-8601 date-time');
  }
  return new Date(value);
}

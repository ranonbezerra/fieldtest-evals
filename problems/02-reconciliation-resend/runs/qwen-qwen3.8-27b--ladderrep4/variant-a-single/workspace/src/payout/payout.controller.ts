import { Body, Controller, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { dateKey, parseDateKey } from './dates.util.js';
import { PayoutService } from './payout.service.js';
import type { DateWindow } from './payout.types.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 31;

@Controller('payout-orders')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  /** Send all pending orders. */
  @Post('execute')
  execute() {
    return this.service.executePayments();
  }

  /** Reconcile the given inclusive statement-date window (YYYY-MM-DD). */
  @Post('reconcile')
  reconcile(@Body() body: unknown) {
    return this.service.reconcile(parseWindow(body));
  }
}

function parseWindow(body: unknown): DateWindow {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_window', 'body must be an object with "from" and "to" in YYYY-MM-DD form', 400);
  }
  const candidate = body as { from?: unknown; to?: unknown };
  const from = parseDateField('from', candidate.from);
  const to = parseDateField('to', candidate.to);
  if (from.getTime() > to.getTime()) {
    throw new ApiError('invalid_window', '"from" must not be after "to"', 400);
  }
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (spanDays > MAX_WINDOW_DAYS) {
    throw new ApiError('invalid_window', `window may span at most ${MAX_WINDOW_DAYS} days`, 400);
  }
  return { from, to };
}

function parseDateField(field: 'from' | 'to', value: unknown): Date {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) {
    throw new ApiError('invalid_window', `"${field}" must be a date in YYYY-MM-DD form`, 400, { field });
  }
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== value) {
    throw new ApiError('invalid_window', `"${field}" must be a valid calendar date`, 400, { field, value });
  }
  return parsed;
}

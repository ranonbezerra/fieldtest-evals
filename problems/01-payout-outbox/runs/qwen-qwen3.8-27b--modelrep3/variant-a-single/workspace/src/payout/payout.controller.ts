import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { Payout } from '@prisma/client';
import { CreatePayoutDto } from './payout.dto.js';
import { PayoutService } from './payout.service.js';

function serializePayout(payout: Payout) {
  return {
    id: payout.id,
    accountId: payout.accountId,
    amount: payout.amountMinor.toString(),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    status: payout.status,
    txHash: payout.txHash,
    error: payout.error,
    createdAt: payout.createdAt,
    sentAt: payout.sentAt,
    completedAt: payout.completedAt,
  };
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto, @Res({ passthrough: true }) res: { status(code: number): unknown }) {
    const { payout, duplicate } = await this.payouts.createPayout(dto);
    if (duplicate) {
      // idempotent replay of an existing payout: not a new resource
      res.status(HttpStatus.OK);
    }
    return { ...serializePayout(payout), duplicate };
  }
}

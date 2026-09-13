import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { PayoutService } from "./payout.service.js";
import { CreatePayoutDto } from "./payout.types.js";

@Controller("payouts")
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPayout(@Body() body: CreatePayoutDto) {
    const payout = await this.payoutService.createPayout(body);
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      createdAt: payout.createdAt,
    };
  }
}

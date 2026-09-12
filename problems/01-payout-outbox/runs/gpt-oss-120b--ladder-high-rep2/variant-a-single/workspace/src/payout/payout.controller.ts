import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { PayoutService } from './payout.service';
import { Payout } from '@prisma/client';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async createPayout(@Body() createPayoutDto: CreatePayoutDto): Promise<Payout> {
    const { accountId, amount, destinationAddress, idempotencyKey } = createPayoutDto;
    try {
      const payout = await this.payoutService.createPayout(
        accountId,
        BigInt(amount),
        destinationAddress,
        idempotencyKey,
      );
      return payout;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      // Unexpected error – wrap in a generic envelope
      throw new HttpException(
        {
          error: {
            code: 'internal_error',
            message: 'An unexpected error occurred',
            details: {},
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

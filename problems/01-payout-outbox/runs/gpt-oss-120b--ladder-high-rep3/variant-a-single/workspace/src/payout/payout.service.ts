import { Injectable } from '@nestjs/common';
import { PayoutRepository, CreatePayoutParams } from './payout.repository';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { Payout } from '@prisma/client';

@Injectable()
export class PayoutService {
  constructor(private readonly payoutRepository: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto): Promise<Payout> {
    const amount = BigInt(dto.amount);
    const params: CreatePayoutParams = {
      accountId: dto.accountId,
      amount,
      destinationAddress: dto.destinationAddress,
      idempotencyKey: dto.idempotencyKey,
    };
    return this.payoutRepository.createPayout(params);
  }
}

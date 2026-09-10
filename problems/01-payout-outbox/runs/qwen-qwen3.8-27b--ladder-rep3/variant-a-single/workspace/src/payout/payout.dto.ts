import type { PayoutStatus } from '@prisma/client';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreatePayoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accountId!: string;

  /**
   * Minor units as a decimal string. JSON numbers are IEEE-754 doubles, and
   * the money path must never pass through `number`.
   */
  @IsString()
  @Matches(/^[0-9]{1,19}$/)
  amount!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  destinationAddress!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey!: string;
}

export interface PayoutView {
  id: string;
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: string;
}

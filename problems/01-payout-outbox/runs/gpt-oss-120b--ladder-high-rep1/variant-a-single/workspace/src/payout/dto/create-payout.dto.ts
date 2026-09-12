import { IsString, IsNotEmpty } from '../../mock/class-validator.js';
import { Transform } from '../../mock/class-transformer.js';
import { IsBigInt } from '../validators/is-bigint.validator.js';

export class CreatePayoutDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @Transform(({ value }) => BigInt(value))
  @IsBigInt({ message: 'Amount must be a valid integer string' })
  amount: bigint;

  @IsString()
  @IsNotEmpty()
  destinationAddress: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}

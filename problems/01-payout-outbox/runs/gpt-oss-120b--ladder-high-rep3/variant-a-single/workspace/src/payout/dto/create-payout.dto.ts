import { IsUUID, IsString, IsNotEmpty, IsNumberString } from 'class-validator';

export class CreatePayoutDto {
  @IsUUID()
  accountId: string;

  @IsNumberString()
  amount: string; // minor units, passed as string to avoid floating point

  @IsString()
  @IsNotEmpty()
  destinationAddress: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}

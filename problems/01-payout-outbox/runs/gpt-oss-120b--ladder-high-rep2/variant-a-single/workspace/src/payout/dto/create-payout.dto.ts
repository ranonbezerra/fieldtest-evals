export class CreatePayoutDto {
  accountId!: string;
  amount!: string; // minor units as string to avoid floating point issues
  destinationAddress!: string;
  idempotencyKey!: string;
}

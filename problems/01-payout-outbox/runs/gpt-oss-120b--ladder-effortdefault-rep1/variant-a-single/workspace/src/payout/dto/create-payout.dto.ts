export class CreatePayoutDto {
  accountId!: string;
  amount!: string; // minor units as string to avoid JS number limits
  destinationAddress!: string;
  idempotencyKey!: string;
}

export class CreatePayoutDto {
  // UUID of the account initiating the payout
  accountId: string;

  // Amount in minor units; transformed to bigint by the service
  amount: bigint;

  // Destination blockchain address
  destinationAddress: string;

  // Idempotency key supplied by the client
  idempotencyKey: string;
}

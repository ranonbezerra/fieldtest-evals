// src/payout/dto/create-payout.dto.ts

export class CreatePayoutDto {
  /**
   * Identifier of the account from which funds will be deducted.
   */
  accountId: string;

  /**
   * Amount to payout, expressed in the smallest currency unit (e.g., cents).
   * Use a number to avoid implicit any; callers should ensure the value fits
   * within JavaScript's safe integer range or handle larger values as strings.
   */
  amount: number;

  /**
   * Blockchain address that will receive the funds.
   */
  destinationAddress: string;

  /**
   * Client‑provided idempotency key to guarantee at‑most‑once creation.
   */
  idempotencyKey: string;
}

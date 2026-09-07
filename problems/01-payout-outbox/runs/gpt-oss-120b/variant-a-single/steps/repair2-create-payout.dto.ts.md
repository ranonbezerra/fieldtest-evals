# repair2-create-payout.dto.ts

## reasoning

```
We need to write DTO fixing errors. Likely missing decorators and types. Use class-validator? Not required. Just define interface with proper types and export. Ensure no implicit any. Provide fields: accountId: string; amount: bigint or number? Use string for big int? Use number with bigint? Use Prisma decimal? Use string. Use idempotencyKey: string; destinationAddress: string.

Add import from class-validator? Not needed compile. Use export class CreatePayoutDto { accountId: string; amount: number; destinationAddress: string; idempotencyKey: string; }

Add constructor? Not needed.

Make sure no implicit any. Provide explicit types.

Also ensure file path correct.

Return code block.
```

## reply

```typescript
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
```

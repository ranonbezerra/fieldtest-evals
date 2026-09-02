# 03-payout.types.ts

## reasoning

```
Let me look at the plan carefully to determine exactly what `src/payout/payout.types.ts` should contain.

From the plan, section 3:

### `src/payout/payout.types.ts`

```ts
// ── Enums (string-union, not TS enum, to keep Prisma happy) ──
export type PayoutStatus = 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs_review';
export type OutboxStatus = 'pending' | 'processing' | 'done';

// ── DTOs ──
export interface CreatePayoutDto {
  accountId: string;
  amount: string;            // decimal-string of minor units; parsed to BigInt in service
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutResponse {
  id: string;
  status: PayoutStatus;
  amount: string;            // minor units as string
}

// ── Provider interface ──
export interface BlockchainProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

// ── Error codes (module-level consts) ──
export const ERROR_INSUFFICIENT_FUNDS = 'insufficient_funds';
export const ERROR_IDEMPOTENCY_CONFLICT = 'idempotency_conflict';
export const ERROR_ACCOUNT_NOT_FOUND = 'resource_not_found';
export const ERROR_VALIDATION = 'validation_failed';
```

The plan explicitly lists this file's contents. I need to write it exactly as specified. Let me also check the "reads" for this file: `src/payout/payout.types.ts | reads: - | PayoutStatus, OutboxStatus, DTOs, BlockchainProvider interface, error code consts`

So it reads nothing (no imports needed). Let me write the complete file.

The project is ESM with `"type": "module"`. No imports needed here since all types and consts are defined locally.

Let me write it out cleanly.
```

## reply

```ts
// ── Enums (string-union, not TS enum, to keep Prisma happy) ──
export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type OutboxStatus = 'pending' | 'processing' | 'done';

// ── DTOs ──
export interface CreatePayoutDto {
  accountId: string;
  amount: string; // decimal-string of minor units; parsed to BigInt in service
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutResponse {
  id: string;
  status: PayoutStatus;
  amount: string; // minor units as string
}

// ── Provider interface ──
export interface BlockchainProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

// ── Error codes (module-level consts) ──
export const ERROR_INSUFFICIENT_FUNDS = 'insufficient_funds';
export const ERROR_IDEMPOTENCY_CONFLICT = 'idempotency_conflict';
export const ERROR_ACCOUNT_NOT_FOUND = 'resource_not_found';
export const ERROR_VALIDATION = 'validation_failed';
```

# 05-payout.types.ts

## reasoning

```
We need answer user's request: write exactly one file src/payout/payout.types.ts complete content in one fenced block, nothing else. Need follow plan. We need think through content.

We have plan section 3 Types and signatures:
```ts
// src/payout/provider.types.ts
export interface PayoutProvider { ... }
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

// src/payout/payout.types.ts
export type PayoutStatus =
  | 'created' | 'processing' | 'sent'
  | 'completed' | 'failed' | 'needs_review';

export type LedgerType = 'reserve' | 'release' | 'settle_out';
export type MessageStatus = 'pending' | 'processing' | 'done' | 'dead';

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutView {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
}

export interface ProviderResult {
  txHash: string;
}
```
But note plan says provider.types.ts has PayoutProvider interface and token. payout.types.ts includes ProviderResult? Yes in plan section 3 under payout.types.ts includes ProviderResult. But maybe provider.types.ts should have PayoutProvider returning Promise<ProviderResult>. The file requested only payout.types.ts. Need implement exactly plan specifies for this file: status/type unions, DTOs, PayoutView. It includes LedgerType, MessageStatus, CreatePayoutDto, PayoutView, ProviderResult. Should not add exports plan doesn't name. The plan names these exports in this file. Could include only those. Need maybe no imports? If ProviderResult used by provider.types.ts, fine. But in this file no dependencies.

Need consider TypeScript strict. Bigint okay. Should we include export type aliases and interfaces exactly. No extra comments? Could be minimal. The user says reply with complete content inside one fenced block, nothing else. Need ensure no extra text.

Potential issue: Plan says `CreatePayoutDto` amount is bigint. But HTTP JSON cannot carry bigint directly; controller may parse string to bigint. But plan says DTO amount: bigint. We follow plan. Could there be need for Payout entity? Not in this file. No.

Need maybe include `Payout`? The repository returns Payout from Prisma, but not in types file. Plan doesn't specify a Payout interface in payout.types.ts. It references `Payout` and `Message` in repository/service signatures, but not defined here. Could be Prisma generated types. We should not add. The file only status/type unions, DTOs, PayoutView.

Need maybe include `PayoutStatus`, `LedgerType`, `MessageStatus`, `CreatePayoutDto`, `PayoutView`, `ProviderResult`. Exactly.

Need think if `ProviderResult` belongs in provider.types.ts? Plan places it under payout.types.ts. The manifest says payout.types.ts reads - | status/type unions, DTOs, PayoutView. It doesn't explicitly mention ProviderResult in manifest description but plan code block includes it. "This file: status/type unions, DTOs, PayoutView" maybe not ProviderResult? But plan is spec and governs. It says implement exactly what plan specifies for this file. The plan's code block for payout.types.ts includes ProviderResult. Should include. But if user's line "This file: status/type unions, DTOs, PayoutView" maybe they summarize. ProviderResult is a type union? It's an interface. But plan includes it. Do not add export plan doesn't name; plan names ProviderResult. Include.

Need maybe include `export type PayoutStatus = ...` etc.

Could there be need for `PayoutProvider`? No, provider.types.ts. Don't include.

Need ensure no default export. Use named exports.

Should we add comments? Not necessary. Maybe no comments to avoid extra. The file can be:

export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type LedgerType = 'reserve' | 'release' | 'settle_out';
export type MessageStatus = 'pending' | 'processing' | 'done' | 'dead';

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutView {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
}

export interface ProviderResult {
  txHash: string;
}

Need maybe order as plan. Good.

Double-check no missing semicolons? TS style can have semicolons. Good.

Need final one fenced block only. Ensure no explanation. Use ```ts ... ```.

Potential hidden issue: The plan says "Amounts are minor units. Do not use floating point for money." BigInt is fine. But JSON DTO might be string? Plan says bigint. We follow.

Potential issue: In NestJS controller body will be object with amount as string/number; but types file only. No.

Potential issue: `ProviderResult` may be redundant with provider.types.ts's return type `{ txHash: string }`. But plan includes. Include.

Need final.
```

## reply

```ts
export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type LedgerType = 'reserve' | 'release' | 'settle_out';

export type MessageStatus = 'pending' | 'processing' | 'done' | 'dead';

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutView {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
}

export interface ProviderResult {
  txHash: string;
}
```

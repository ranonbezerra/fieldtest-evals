# 04-provider.types.ts

## reasoning

```
We need answer user's request: write exactly one file src/payout/provider.types.ts, complete content in one fenced block, nothing else. Need follow plan. Need think in English (user request English). Need ensure no extra explanation. Need produce code.

We need infer exact file content from PLAN.md:
```ts
// src/payout/provider.types.ts
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER'; // injection token
```
Need maybe import? No. Need TypeScript strict. Could use `export const PAYOUT_PROVIDER: unique symbol`? Plan says token 'PAYOUT_PROVIDER' string. Use exactly. Need no extra exports. Maybe include JSDoc? Probably okay but "Implement exactly what plan specifies" no add export/feature. Comments maybe not needed. Need complete file. Could include only interface and const. Need consider NestJS injection token: string is fine. If using `export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';` type is string. In providers: `{ provide: PAYOUT_PROVIDER, useValue: ... }`. Good.

Need ensure first line to last. Fenced block only. No explanation. Could include `export type ProviderTransferResult = { txHash: string };`? Plan does not name; do not add. The plan's ProviderResult in payout.types.ts maybe separate, but this file only interface + token. So no extra type.

Need maybe `export const PAYOUT_PROVIDER = Symbol('PayoutProvider')`? Plan explicitly says token value implements and `PAYOUT_PROVIDER` token, code shows string. Use string.

Need maybe strict mode: interface method `transfer(to: string, amount: bigint): Promise<{ txHash: string }>;` fine.

Final only fenced code. Ensure no trailing explanation.
```

## reply

```ts
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';
```

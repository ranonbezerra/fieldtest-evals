# 02-provider.interface.ts

## reasoning

```
The task is to write exactly one file: `src/payout/provider.interface.ts`.

According to the plan, this file "Re-exports `BlockchainProvider` from `payout.types.ts` (single file to avoid circular imports if needed; here it's just a re-export barrel)."

The plan specifies:
- `src/payout/provider.interface.ts` reads `src/payout/payout.types.ts`
- It re-exports `BlockchainProvider`

So the file should simply be a re-export of `BlockchainProvider` from `payout.types.ts`.

The simplest and most correct implementation:

```ts
export type { BlockchainProvider } from './payout.types';
```

Or:

```ts
export { BlockchainProvider } from './payout.types';
```

Since `BlockchainProvider` is an interface (type-only), using `export type` is the more correct approach in TypeScript, especially with ESM and strict mode. However, `export { BlockchainProvider }` would also work since TypeScript can handle it. But given the conventions say ESM and strict mode, `export type` is safer and more explicit.

Actually, let me reconsider. The plan says "Re-exports `BlockchainProvider` from `payout.types.ts`". It's described as a "re-export barrel". The most defensible reading is simply:

```ts
export type { BlockchainProvider } from './payout.types';
```

This is clean, minimal, and exactly what the plan specifies. No extra exports, no extra features.
```

## reply

```ts
export type { BlockchainProvider } from './payout.types';
```

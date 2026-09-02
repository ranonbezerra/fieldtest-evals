# repair1-provider.interface.ts

## reasoning

```
The error message for `src/payout/provider.interface.ts` is:

```
src/payout/provider.interface.ts(1,41): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
```

This means the file is trying to import from `./payout.types` (without `.js` extension), but since this is an ESM project (`"type": "module"`), the import needs the `.js` extension.

Looking at the other files in the workspace, `payout.repository.ts` imports from `'./payout.types.js'` (with `.js`). So the fix is to use the `.js` extension in the import.

According to the plan, `src/payout/provider.interface.ts` "Re-exports `BlockchainProvider` from `payout.types.ts` (single file to avoid circular imports if needed; here it's just a re-export barrel)."

So the file should be:

```ts
export type { BlockchainProvider } from './payout.types.js';
```

That's it. The error is simply the missing `.js` extension on the import path.
```

## reply

```ts
export type { BlockchainProvider } from './payout.types.js';
```

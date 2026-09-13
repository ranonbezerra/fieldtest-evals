# repair1-set

## reasoning

```
Looking at the errors:

1. `src/orders/orders.status.ts(2,10)`: Import declaration conflicts with local declaration of 'mapProviderStatus'. The file imports `mapProviderStatus` from the shared mapper but also defines its own `mapProviderStatus` function. Name collision.

2. `src/orders/orders.status.ts(13,34)`: Expected 1 arguments, but got 2. The local `mapProviderStatus` function only takes 1 argument but is being called with 2 (the code and the options object).

3. Same two issues in `src/payouts/payouts.status.ts`.

The fix: rename the local functions to avoid the collision (e.g., `mapOrderProviderStatus` and `mapPayoutProviderStatus`), and update the calls inside them to match the shared mapper's signature. But wait — I need to look at the reference files to understand the current state.

From the reference:

**orders.status.ts** currently:
- Imports `mapProviderStatus` from `../shared/payment-status-mapper.js`
- Defines a local `mapProviderStatus(code: string): OrderStatus`
- Inside, calls `mapProviderStatus(code, { onUnknown: 'throw' })` — but the local function only takes 1 arg, so this is the conflict.

**payouts.status.ts** currently:
- Imports `mapProviderStatus` from `../shared/payment-status-mapper.js`
- Defines a local `mapProviderStatus(code: string): PayoutStatus`
- Inside, calls `mapProviderStatus(code, { onUnknown: 'unknown' })` — same issue.

The fix strategy: rename the local wrapper functions so they don't collide with the imported name. The wrappers take a code string and delegate to the imported `mapProviderStatus` with the appropriate options.

For orders: rename local to something like `mapOrderProviderStatus`, and it calls `mapProviderStatus(code, { onUnknown: 'throw' })`.

For payouts: rename local to something like `mapPayoutProviderStatus`, and it calls `mapProviderStatus(code, { onUnknown: 'unknown' })`.

But wait — the instruction says "Do not rename anything the errors do not mention." The errors mention the import conflict and the argument mismatch. Renaming the local function is the natural fix for the import conflict. The argument mismatch is resolved by the fact that the imported `mapProviderStatus` accepts 2 args.

Actually, let me re-read: "Change exactly what the compiler requires." The import conflicts with local declaration — so I need to either rename the import or rename the local. Since the local is a wrapper that needs the import, I should rename the local function.

Let me check — the file names are `orders.status.ts` and `payouts.status.ts`. The function names should probably be `mapProviderStatus` in each (that's what the reference shows). But the import conflicts.

Options:
1. Rename the local function (e.g., `mapOrderStatus`, `mapPayoutStatus`)
2. Rename the import (e.g., `import { mapProviderStatus as mapSharedStatus }`)

Since the reference files show the local function is named `mapProviderStatus` and is the public API, and the instruction says not to rename anything the errors don't mention... but the error IS about the name collision. I think renaming the import alias is the least invasive:

```ts
import { mapProviderStatus as mapSharedStatus } from '../shared/payment-status-mapper.js';
```

Then the local `mapProviderStatus` function calls `mapSharedStatus(code, { onUnknown: 'throw' })`.

This preserves all existing names and fixes both errors. Let me go with this approach.
```

## reply

### src/orders/orders.status.ts
```ts
// Provider status -> internal status, for the order detail screen.
import { mapProviderStatus as mapSharedStatus } from '../shared/payment-status-mapper.js';

export type OrderStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export function mapProviderStatus(code: string): OrderStatus {
  return mapSharedStatus(code, { onUnknown: 'throw' }) as OrderStatus;
}
```

### src/payouts/payouts.status.ts
```ts
// Provider status -> internal status, for payout reconciliation.
// Same provider, two extra codes this side of the integration can receive.
import { mapProviderStatus as mapSharedStatus } from '../shared/payment-status-mapper.js';

export type PayoutStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback'
  | 'unknown';

export function mapProviderStatus(code: string): PayoutStatus {
  return mapSharedStatus(code, { onUnknown: 'unknown' }) as PayoutStatus;
}
```

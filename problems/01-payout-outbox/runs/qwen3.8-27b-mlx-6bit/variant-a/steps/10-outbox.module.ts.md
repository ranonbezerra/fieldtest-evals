# 10-outbox.module.ts

## reasoning

```
Analyzing the plan for `src/outbox/outbox.module.ts`:

From the PLAN.md:
```
### `src/outbox/outbox.module.ts`

Providers: `OutboxRepository`, `OutboxService`.  
Imports: `PayoutModule` (for `PayoutRepository`).
```

From the manifest:
```
src/outbox/outbox.module.ts | reads: src/outbox/outbox.service.ts, src/outbox/outbox.repository.ts, src/payout/payout.module.ts | Module wiring for outbox worker
```

So I need to:
- Import `OutboxService` from `./outbox.service.js`
- Import `OutboxRepository` from `./outbox.repository.js`
- Import `PayoutModule` from `../payout/payout.module.js`
- Declare the module with providers `[OutboxRepository, OutboxService]` and imports `[PayoutModule]`

Now, the `OutboxService` also depends on `BlockchainProvider`. Looking at the plan, the provider interface is defined in `payout.types.ts` as an interface. But how is it provided? The plan says "Provider SDK interface: `BlockchainProvider` interface, injected via DI". 

Looking at the outbox service constructor:
```ts
constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: BlockchainProvider,
) {}
```

So `BlockchainProvider` needs to be injectable. But the plan doesn't explicitly mention a provider token or implementation in the outbox module. Let me look more carefully...

The plan says:
- `src/payout/provider.interface.ts` — "Re-exports `BlockchainProvider` from `payout.types.ts`"
- The module wiring for outbox says: "Providers: `OutboxRepository`, `OutboxService`. Imports: `PayoutModule` (for `PayoutRepository`)."

The plan doesn't explicitly mention how `BlockchainProvider` is provided. It's an interface, so it would need a token or a concrete implementation registered somewhere. But the plan only specifies those two providers for the outbox module and doesn't mention a provider implementation or token.

Looking at the plan's assumption: "Provider SDK interface: `BlockchainProvider` interface, injected via DI | Testability; the task says 'assume' the SDK"

Since the plan doesn't specify a concrete implementation or a token in the outbox module, and the file I'm writing is specifically "Module wiring for outbox worker" with only `OutboxRepository` and `OutboxService` as providers, I should follow the plan exactly. The `BlockchainProvider` would presumably be provided at a higher level (AppModule) or via a custom provider token that's registered elsewhere.

But wait - for the module to actually work, `BlockchainProvider` needs to be available. Since the plan only lists `OutboxRepository` and `OutboxService` as providers and `PayoutModule` as the import, I should follow that exactly. The `BlockchainProvider` is presumably registered at the app level or via some other mechanism not specified in this module.

Actually, re-reading the discipline: "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change." And the plan explicitly says:

"Providers: `OutboxRepository`, `OutboxService`. Imports: `PayoutModule` (for `PayoutRepository`)."

So I'll write exactly that. The `BlockchainProvider` injection would be handled at a higher level (perhaps AppModule provides it), which is not my concern for this file.

Let me write the module:

```ts
import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OutboxRepository } from './outbox.repository.js';
import { PayoutModule } from '../payout/payout.module.js';

@Module({
  imports: [PayoutModule],
  providers: [OutboxRepository, OutboxService],
})
export class OutboxModule {}
```

This matches the plan exactly. No controller is declared (the worker isn't an HTTP endpoint). The module has no exports (nothing else needs to import from it).

This is clean and follows the plan precisely.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';
import { OutboxRepository } from './outbox.repository.js';
import { PayoutModule } from '../payout/payout.module.js';

@Module({
  imports: [PayoutModule],
  providers: [OutboxRepository, OutboxService],
})
export class OutboxModule {}
```

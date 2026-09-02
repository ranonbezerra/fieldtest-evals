# 11-app.module.ts

## reasoning

```
The task is to write `src/app.module.ts` — the root module that imports both feature modules (PayoutModule and OutboxModule).

From the plan's manifest:
```
src/app.module.ts | reads: src/payout/payout.module.ts, src/outbox/outbox.module.ts | Root module, imports both feature modules
```

From the references:
- `PayoutModule` is exported from `src/payout/payout.module.js`
- `OutboxModule` is exported from `src/outbox/outbox.module.js`

The file layout convention says:
```
src/app.module.ts
```

TS file naming convention is `kebab-case.role.ts`, so `app.module.ts` fits.

The root module should:
1. Import `Module` from `@nestjs/common`
2. Import `PayoutModule` from `./payout/payout.module.js`
3. Import `OutboxModule` from `./outbox/outbox.module.js`
4. Declare a class `AppModule` decorated with `@Module({ imports: [PayoutModule, OutboxModule] })`

That's it. No controllers, no providers of its own. Just imports both feature modules. The plan says "Root module, imports both feature modules" — nothing more.

Let me write it clean and complete.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';
import { OutboxModule } from './outbox/outbox.module.js';

@Module({
  imports: [PayoutModule, OutboxModule],
})
export class AppModule {}
```

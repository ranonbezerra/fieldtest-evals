# repair1-notifications.module.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/notifications/notifications.module.ts`:

1. `src/notifications/notifications.module.ts(2,38): error TS2307: Cannot find module './notifications.service' or its corresponding type declarations.`
2. `src/notifications/notifications.module.ts(3,29): error TS2307: Cannot find module '../retry/retry.module' or its corresponding type declarations.`

The project uses ESM with `"type": "module"`. Looking at the reference file `src/notifications/notifications.service.ts`, it imports with `.js` extensions:
```ts
import { QUEUES, QueueName } from '../common/queues.js';
import { RetryProcessor } from '../retry/retry.processor.js';
```

So the module file needs to use `.js` extensions in its imports. The errors say:
- Line 2, col 38: Cannot find module `./notifications.service` — should be `./notifications.service.js`
- Line 3, col 29: Cannot find module `../retry/retry.module` — should be `../retry/retry.module.js`

Now let me look at the PLAN.md for what `NotificationsModule` should look like:

```
**`src/notifications/notifications.module.ts` — `NotificationsModule`**
```
providers: [NotificationsService]          // + NotificationsRepository if present
exports:   []
imports:   [RetryModule]                   // needs RetryProcessor for enqueueing
```

So the module should:
- Import `NotificationsService` from `./notifications.service.js`
- Import `RetryModule` from `../retry/retry.module.js`
- Have `providers: [NotificationsService]`
- Have `exports: []`
- Have `imports: [RetryModule]`

Now, the error about `src/retry/retry.module.ts(2,32): error TS2307: Cannot find module './retry.processor'` — this is about the retry module file, not the notifications module. But the notifications module imports `../retry/retry.module.js`. The compiler can't find it because... wait, the error is on line 3 of notifications.module.ts. The error says "Cannot find module '../retry/retry.module'" — this means the file `src/retry/retry.module.ts` exists (it's referenced in other errors like `src/retry/retry.module.ts(2,32)`) but the import path in notifications.module.ts is wrong (missing `.js` extension).

Wait, let me re-read. The error is `Cannot find module '../retry/retry.module'`. In ESM mode with TypeScript, you need the `.js` extension. So the fix is to use `../retry/retry.module.js`.

Similarly for `./notifications.service` → `./notifications.service.js`.

Let me also check: the PLAN says the notifications module is at `src/notifications/notifications.module.ts`. The retry module is at `src/retry/retry.module.ts`. So from notifications, the relative path to retry module is `../retry/retry.module.js`.

Now let me write the complete file:

```ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { RetryModule } from '../retry/retry.module.js';

@Module({
  providers: [NotificationsService],
  imports: [RetryModule],
})
export class NotificationsModule {}
```

Wait, the error says "Cannot find module './notifications.service'" at line 2, col 38. That's the import path without `.js`. And "Cannot find module '../retry/retry.module'" at line 3, col 29. Also without `.js`.

The fix is simply to add `.js` extensions to both imports. The rest of the module structure (providers, exports, imports) stays as per the plan.

Let me verify: the plan says `exports: []` — I can either omit it or explicitly set it. I'll omit it since it's the default and the plan just says empty.

Actually, looking more carefully at the plan:
```
providers: [NotificationsService]          // + NotificationsRepository if present
exports:   []
imports:   [RetryModule]                   // needs RetryProcessor for enqueueing
```

The `+ NotificationsRepository if present` — I don't have visibility into whether there's a notifications repository. The compiler errors don't mention one, and the task says "Change nothing the messages do not name." So I'll just include `NotificationsService` in providers.

Let me finalize:

```ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { RetryModule } from '../retry/retry.module.js';

@Module({
  providers: [NotificationsService],
  imports: [RetryModule],
})
export class NotificationsModule {}
```

This fixes both errors:
1. `./notifications.service` → `./notifications.service.js` (fixes TS2307 on line 2)
2. `../retry/retry.module` → `../retry/retry.module.js` (fixes TS2307 on line 3)

And it satisfies the plan's wiring requirements.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { RetryModule } from '../retry/retry.module.js';

@Module({
  providers: [NotificationsService],
  imports: [RetryModule],
})
export class NotificationsModule {}
```

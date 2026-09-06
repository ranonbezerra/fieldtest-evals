# 04-notifications.module.ts

## reasoning

```
Looking at the plan for `src/notifications/notifications.module.ts`:

```
providers: [NotificationsService]          // + NotificationsRepository if present
exports:   []
imports:   [RetryModule]                   // needs RetryProcessor for enqueueing
```

The plan says:
- `NotificationsService` must import `QUEUES` from `src/common/queues.ts`, **not** from any feature file.
- The module imports `RetryModule`.

I need to write the NotificationsModule class with:
- providers: [NotificationsService]
- exports: []
- imports: [RetryModule]

I need to import:
- `Module` from `@nestjs/common`
- `NotificationsService` from `./notifications.service`
- `RetryModule` from `../retry/retry.module`

The plan mentions "+ NotificationsRepository if present" — but I don't have any reference showing a NotificationsRepository file. The manifest only lists:
- src/notifications/notifications.module.ts
- src/notifications/notifications.service.ts

No repository is mentioned in the manifest for notifications. So I'll just include NotificationsService in providers.

Let me write the file:
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RetryModule } from '../retry/retry.module';

@Module({
  providers: [NotificationsService],
  exports: [],
  imports: [RetryModule],
})
export class NotificationsModule {}
```

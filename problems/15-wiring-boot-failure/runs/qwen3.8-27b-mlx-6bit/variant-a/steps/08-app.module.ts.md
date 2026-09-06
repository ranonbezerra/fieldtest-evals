# 08-app.module.ts

## reasoning

```
The task is to write `src/app.module.ts` based on the plan. According to the plan:

**`src/app.module.ts` — `AppModule`**
```
providers: []
exports:   []
imports:   [NotificationsModule, UsersModule, ExportModule, RetryModule]
```

I need to import:
- `NotificationsModule` from `src/notifications/notifications.module.ts`
- `UsersModule` from `src/users/users.module.ts`
- `ExportModule` from `src/export/export.module.ts`
- `RetryModule` from `src/retry/retry.module.ts`

The file should be complete, first line to last, with the `@Module` decorator and class.

Let me write it:
```

## reply

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from './notifications/notifications.module';
import { UsersModule } from './users/users.module';
import { ExportModule } from './export/export.module';
import { RetryModule } from './retry/retry.module';

@Module({
  providers: [],
  exports: [],
  imports: [NotificationsModule, UsersModule, ExportModule, RetryModule],
})
export class AppModule {}
```

# repair1-app.module.ts

## reasoning

```
Let me analyze the compiler errors for `src/app.module.ts`:

```
src/app.module.ts(2,37): error TS2307: Cannot find module './notifications/notifications.module' or its corresponding type declarations.
src/app.module.ts(3,29): error TS2307: Cannot find module './users/users.module' or its corresponding type declarations.
src/app.module.ts(4,30): error TS2307: Cannot find module './export/export.module' or its corresponding type declarations.
src/app.module.ts(5,29): error TS2307: Cannot find module './retry/retry.module' or its corresponding type declarations.
```

These errors say the modules can't be found. Looking at the workspace structure, I need to figure out the correct import paths. The project uses ESM (`"type": "module"`), so imports need the `.js` extension.

Looking at the other files in the workspace:
- `src/notifications/notifications.service.ts` imports from `'../common/queues.js'` and `'../retry/retry.processor.js'` — so the convention is `.js` extensions.

The current `src/app.module.ts` imports:
- `'./notifications/notifications.module'` (line 2)
- `'./users/users.module'` (line 3)
- `'./export/export.module'` (line 4)
- `'./retry/retry.module'` (line 5)

These are missing the `.js` extension. The fix is to add `.js` to each import path.

Now let me check the PLAN for what `AppModule` should look like:
```
providers: []
exports:   []
imports:   [NotificationsModule, UsersModule, ExportModule, RetryModule]
```

So the complete file should import the four modules with `.js` extensions and declare them in `imports`.

Let me also check if there's a `PrismaModule` that should be imported. Looking at the PLAN, it doesn't mention one explicitly in AppModule's imports. The plan says:
```
imports:   [NotificationsModule, UsersModule, ExportModule, RetryModule]
```

No PrismaModule listed. But wait — the services likely use PrismaService. Let me think about this...

Actually, looking at the PLAN more carefully, it says "Change wiring, not behaviour." The plan specifies exactly what AppModule should have. I should follow the plan.

But wait — if services depend on PrismaService, and there's no PrismaModule providing it, the wiring test would fail. However, the task says "Change nothing the messages do not name." The compiler errors for `src/app.module.ts` only complain about missing modules (TS2307). They don't say anything about missing providers.

The errors are purely about module resolution — the `.js` extension is missing. Let me just fix those paths.

Let me write the complete `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from './notifications/notifications.module.js';
import { UsersModule } from './users/users.module.js';
import { ExportModule } from './export/export.module.js';
import { RetryModule } from './retry/retry.module.js';

@Module({
  imports: [NotificationsModule, UsersModule, ExportModule, RetryModule],
})
export class AppModule {}
```

Wait, but I should check — does the current file have `providers` or `exports` arrays? The PLAN says `providers: []` and `exports: []`. But since the compiler errors don't mention anything about those, and the instruction says "Change nothing the messages do not name," I should keep it minimal. However, an empty array is optional in NestJS module metadata — omitting it is equivalent to having `[]`. So I'll just have `imports`.

Actually, let me reconsider. The task says "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file." The messages only require that the module paths resolve. So I need to add `.js` extensions to the import paths.

The plan says `providers: []` and `exports: []` — these are empty so they can be omitted without changing behavior. I'll keep it clean with just `imports`.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from './notifications/notifications.module.js';
import { UsersModule } from './users/users.module.js';
import { ExportModule } from './export/export.module.js';
import { RetryModule } from './retry/retry.module.js';

@Module({
  imports: [NotificationsModule, UsersModule, ExportModule, RetryModule],
})
export class AppModule {}
```

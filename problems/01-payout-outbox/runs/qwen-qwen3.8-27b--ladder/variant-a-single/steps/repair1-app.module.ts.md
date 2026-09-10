# repair1-app.module.ts

## reasoning

```
Let me analyze the compiler errors to understand what `src/app.module.ts` needs to look like.

The errors are:
1. `src/payout/payout.repository.ts` - errors about Prisma transaction types and ledger line creation
2. `src/payout/payout.service.ts` - Cannot find modules: `./payout.repository`, `./payout.errors`, `./payout.types`
3. `src/payout/payout.worker.ts` - Cannot find modules: `./payout.repository`, `./payout.provider`, `./payout.types`
4. `test/payout.spec.ts` - Cannot find various modules
5. `test/payout.spec.ts(48,5)` - `'transfer' does not exist in type 'TestProvider'`

Wait, the task says "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file."

But looking at the errors, none of them are actually about `src/app.module.ts` directly. The errors are about other files. However, the task specifically asks me to rewrite `src/app.module.ts`.

Let me think about what `src/app.module.ts` needs to do:
- It's the root module
- It needs to import `PayoutModule`
- It needs to apply the `AllExceptionsFilter` globally (since it exists in `src/common/exception.filter.ts`)
- It might need to configure PrismaService or similar

Wait, let me re-read the instructions: "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file."

The key insight is that the errors are in other files, but the task is asking me to fix `src/app.module.ts`. The errors that "require" something of `app.module.ts` would be:

1. The module needs to properly import and wire up the payout module
2. The exception filter needs to be applied globally

Looking at the errors more carefully:
- `src/payout/payout.service.ts` imports `./payout.repository`, `./payout.errors`, `./payout.types`
- `src/payout/payout.worker.ts` imports `./payout.repository`, `./payout.provider`, `./payout.types`
- `test/payout.spec.ts` imports various modules

These "Cannot find module" errors suggest the files don't exist yet. But the task says "Change nothing the messages do not name." and "Rewrite `src/app.module.ts` complete."

So I think the task is: given that these other files have errors (which will be fixed separately or are being fixed), what should `src/app.module.ts` look like to properly wire everything together?

Based on the conventions:
- `src/app.module.ts` is the root module
- It should import `PayoutModule`
- It should apply the `AllExceptionsFilter` globally via `APP_FILTER`

The `PayoutModule` would be at `src/payout/payout.module.ts` based on the naming convention `<feature>.module.ts`.

Looking at the files that exist based on the errors:
- `src/payout/payout.controller.ts` (implied by the feature)
- `src/payout/payout.service.ts`
- `src/payout/payout.worker.ts`
- `src/payout/payout.repository.ts`
- `src/payout/payout.errors.ts`
- `src/payout/payout.types.ts`
- `src/payout/payout.provider.ts`
- `src/payout/payout.module.ts`

The `app.module.ts` needs to:
1. Import `PayoutModule`
2. Apply `AllExceptionsFilter` globally

Let me also consider if there's a `PrismaModule` or similar. Looking at the schema, there's a Prisma setup. Typically in NestJS with Prisma, you'd have a `PrismaModule` that provides and exports a `PrismaService`. But the conventions don't mention it explicitly.

Actually, looking at the reference workspace, there's `src/common/exception.filter.ts` which is the `AllExceptionsFilter`. The `app.module.ts` should apply it.

Let me write a minimal `src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PayoutModule } from './payout/payout.module';
import { AllExceptionsFilter } from './common/exception.filter';

@Module({
  imports: [PayoutModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

This is the minimal thing that `app.module.ts` needs to do based on the conventions and the errors shown. The errors are in other files, but `app.module.ts` needs to:
1. Import the payout module (so the feature is wired up)
2. Apply the exception filter globally (so the error envelope format is consistent)

I don't think I need to add anything else. The Prisma connection would be handled within the payout module or a shared module, but since the errors don't name any issue with app.module.ts specifically, I should keep it minimal and just ensure it properly imports the payout module and applies the filter.

Wait, actually let me reconsider. The task says "fixing what these messages require of this file." The messages don't directly name `app.module.ts`. But the implicit requirement is that `app.module.ts` must import `PayoutModule` for the feature to work, and it should apply the global exception filter.

Let me keep it simple and correct.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PayoutModule } from './payout/payout.module';
import { AllExceptionsFilter } from './common/exception.filter';

@Module({
  imports: [PayoutModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

# repair2-app.module.ts

## reasoning

```
Let me analyze the compiler errors:

1. `src/app.module.ts(3,31): error TS2307: Cannot find module './payment/payment.module' or its corresponding type declarations.` — This means `src/payment/payment.module.ts` doesn't exist yet. I need to create it, but wait — the task says "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

So I need to fix `src/app.module.ts`. The error says it can't find `./payment/payment.module`. That module file doesn't exist. But the task says to only fix what `src/app.module.ts` needs. The module file is a separate file that needs to exist for the import to work.

Wait, let me re-read: "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file."

The error in `src/app.module.ts` is that it imports `./payment/payment.module` which doesn't exist. The fix for `src/app.module.ts` would be to either:
- Remove the import (but that would drop a requirement from PLAN.md)
- Keep the import and ensure the module file exists

But the task says "Change nothing the messages do not name." The other errors are in `payment.repository.ts` and `test/payment.spec.ts` — those are separate files I shouldn't touch.

So for `src/app.module.ts`, the only error is that it can't find `./payment/payment.module`. The plan says `src/app.module.ts` imports only `PaymentModule`. So I need to write `src/app.module.ts` that imports `PaymentModule` from `./payment/payment.module`.

But wait — the file `src/payment/payment.module.ts` doesn't exist. The error is in `app.module.ts` because of the missing file. But the task says to only fix `src/app.module.ts`. 

Hmm, but if I just write `app.module.ts` with the import, it will still fail because `payment.module.ts` doesn't exist. The task says "fixing what these messages require of this file" — meaning what does `src/app.module.ts` need to be correct? It needs to import `PaymentModule` from the right path. The fact that the module file doesn't exist is a problem for another file, not for `app.module.ts` itself.

Actually, re-reading more carefully: "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file." This means I should write the complete content of `src/app.module.ts` such that it satisfies what the compiler errors require of THIS FILE specifically.

The error for `app.module.ts` is: `Cannot find module './payment/payment.module'`. The fix in `app.module.ts` is to correctly reference the module. Since the plan specifies it should be at `src/payment/payment.module.ts`, the import path `'./payment/payment.module'` is correct. The file just doesn't exist yet — that's a separate issue for another file.

So my `src/app.module.ts` should:
1. Import `Module` from `@nestjs/common`
2. Import `PaymentModule` from `./payment/payment.module`
3. Declare the root module with `imports: [PaymentModule]`

Let me also check: the plan says "app.module.ts imports only PaymentModule; no other feature modules."

So the file should be:

```typescript
import { Module } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [PaymentModule],
})
export class AppModule {}
```

This is the minimal correct `app.module.ts`. The other errors (bigint vs number in repository, missing service and interface files) are in other files and I'm told not to change them.

Wait, but the task says "fixing what these messages require of this file" — the only message that names `app.module.ts` is the first one about the missing module. So I just need to make sure `app.module.ts` is correct with respect to that import. The path `'./payment/payment.module'` is the correct path per the plan, so the file content is correct — it's just that the target doesn't exist yet.

I'll write the complete `src/app.module.ts` with the correct import.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [PaymentModule],
})
export class AppModule {}
```

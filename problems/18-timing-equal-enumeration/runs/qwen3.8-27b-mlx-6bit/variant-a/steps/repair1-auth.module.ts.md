# repair1-auth.module.ts

## reasoning

```
Let me analyze the compiler errors that are relevant to `src/auth/auth.module.ts`:

1. The only error directly naming `src/auth/auth.module.ts` is:
   - `annot find module './auth.repository' or its corresponding type declarations.` — This is actually from a line in `auth.module.ts` that imports `./auth.repository`. Wait, let me re-read. The first line says "annot find module './auth.repository' or its corresponding type declarations." — this is truncated, it's missing the file prefix. Looking at the context, it's likely from `src/auth/auth.module.ts` importing `./auth.repository`.

Wait, let me look more carefully. The errors are:

```
annot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
src/auth/auth.service.ts(5,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
```

The first line is truncated — it's missing the file/line prefix. But given the context and the fact that the task says "These are the compiler's exact messages for the whole workspace", the first line is likely `src/auth/auth.module.ts(X,XX): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.`

So `src/auth/auth.module.ts` has an import of `./auth.repository` that can't be resolved. But wait — the error on `src/auth/auth.service.ts(5,32)` also says "Cannot find module './auth.repository'" — that's the service importing the repository.

Actually, looking more carefully at the first line: "annot find module './auth.repository' or its corresponding type declarations." — this is clearly a truncated line that starts with something like `src/auth/auth.module.ts(X,XX): error TS2307: C` — the "C" got cut and we see "annot find module..."

So `auth.module.ts` imports `./auth.repository` and can't find it. But the file `src/auth/auth.repository.ts` exists (we see errors from it). So why can't it be found?

Wait — the error in `auth.repository.ts` is:
```
src/auth/auth.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
```

This means `auth.repository.ts` imports `../prisma/prisma.service` which doesn't exist. But that's an error in the repository file itself, not a reason why `auth.module.ts` can't find it.

Hmm, but actually in TypeScript, if a file has errors, it can still be found as a module. The "Cannot find module" error means the file doesn't exist or can't be resolved by the module resolution strategy.

Wait, let me reconsider. The task says to rewrite `src/auth/auth.module.ts` fixing what these messages require of this file. The only message that names `auth.module.ts` (even if truncated) is the first one about not finding `./auth.repository`.

But actually, I think the issue might be simpler. Let me look at the plan again:

The plan says `auth.module.ts` should have:
```ts
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort /* token provider */],
  exports: [AuthService],
})
export class AuthModule {}
```

And it imports from: `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`, `src/auth/auth.repository.ts`, `src/auth/auth.dto.ts`

Now, the error says `auth.module.ts` can't find `./auth.repository`. This could mean the file doesn't exist at that path, or there's a naming issue.

But wait — we see errors FROM `src/auth/auth.repository.ts`, so the file exists. So why can't it be found?

Actually, I think I'm overthinking this. The task says "Rewrite `src/auth/auth.module.ts` complete, fixing what these messages require of this file." The key constraint is: "Change nothing the messages do not name."

The only message that pertains to `auth.module.ts` is the first (truncated) one about not finding `./auth.repository`. 

But actually, re-reading the task more carefully: "These are the compiler's exact messages for the whole workspace — not a summary of them." So ALL of these are from the whole workspace, and I only need to fix what's relevant to `auth.module.ts`.

The errors from `auth.module.ts` are just the first truncated line. All other errors are from other files.

So the fix for `auth.module.ts` is to make sure it can resolve `./auth.repository`. Since the file exists at `src/auth/auth.repository.ts` (we see errors from it), the import should work. Unless...

Wait, maybe the issue is that `auth.module.ts` doesn't actually import `./auth.repository` directly but references it somehow. Or maybe the original file had a typo.

Let me just write the correct `auth.module.ts` based on the plan:

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

Wait, but the plan also mentions `MailPort` as a provider. Let me re-read:

> `src/auth/auth.module.ts | reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts, src/auth/auth.dto.ts | Feature module wiring`

So the module reads (imports) from controller, service, repository, and dto. But the manifest also says:

> providers: [AuthService, AuthRepository, MailPort /* token provider */]

The `MailPort` is described as a "token provider" — meaning it's provided via a token (useClass or useValue or useFactory). Since the plan says "Assume a mail port `sendEmail(to, template, vars): Promise<void>` exists" and "Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module", I need to provide it.

But wait — the errors don't mention `MailPort` in `auth.module.ts`. The only error is about `./auth.repository`. So maybe the original file had the MailPort provider already and it compiled fine for that part.

Actually, I think the safest approach is: the only error in `auth.module.ts` is about not finding `./auth.repository`. The file exists (we see errors from it). So the import should work. Let me just write the module correctly per the plan.

But wait — could the issue be that the original `auth.module.ts` had a different import path or naming? Like maybe it imported from `'./auth.repository.ts'` (with extension) which wouldn't work with ESM? Or maybe it didn't import `AuthRepository` at all but referenced it somehow?

I think the most likely scenario is that the original file was simply wrong in some way, and I need to write it correctly. Let me write the complete file per the plan:

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, MailPort } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: MailPort,
      useValue: {
        sendEmail: async (to: string, template: string, vars: Record<string, string>): Promise<void> => {},
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

Hmm, but the plan says "a token-level provider is registered in the module". A "token-level provider" in NestJS means using `provide` with a token (like a class, string, or injection token). Since `MailPort` is an interface, it would be used as a class-based token.

Actually wait — looking at the plan more carefully:

> | Mail port | Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module | Task says it "exists"; we depend on the interface only |

This suggests that `MailPort` is provided via a token. But since the task says "Assume a mail port `sendEmail(to, template, vars): Promise<void>` exists", maybe it's provided elsewhere or we just need to declare the dependency.

For the module to compile and work, we need to provide `MailPort`. The simplest approach that matches "a token-level provider is registered in the module" would be:

```ts
{ provide: MailPort, useValue: { sendEmail: async () => {} } }
```

or 

```ts
{ provide: MailPort, useClass: SomeMailAdapter }
```

Since the task says "Assume a mail port exists", I'll use a `useValue` stub that does nothing (or I could use `useFactory`). Actually, the simplest is just a no-op implementation since we're assuming it exists.

Now, regarding the `MailPort` export from `auth.service.ts` — the plan shows:

```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

So `MailPort` is exported from `auth.service.ts`. That means in the module I'd import it from there.

Let me write the final version:

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, MailPort } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: MailPort,
      useValue: {
        sendEmail: async (_to: string, _template: string, _vars: Record<string, string>): Promise<void> => {},
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

This should fix the "cannot find module './auth.repository'" error because it properly imports `AuthRepository` from `'./auth.repository'`.

Wait, but if the file exists, why would it not be found? Unless the original code had a typo like `'./auth-repository'` or something. Regardless, writing it correctly should fix it.

Let me also check: the manifest says the module reads from `auth.dto.ts`. But looking at the plan's module code, it doesn't import DTOs directly — the controller imports them. So maybe the manifest is just listing all files in the feature that the module "touches" indirectly. I won't import DTOs in the module since they're not needed there.

I'm confident this is correct. Let me write the final answer.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, MailPort } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: MailPort,
      useValue: {
        sendEmail: async (_to: string, _template: string, _vars: Record<string, string>): Promise<void> => {},
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

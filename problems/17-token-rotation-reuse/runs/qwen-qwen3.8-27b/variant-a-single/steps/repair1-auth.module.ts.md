# repair1-auth.module.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/auth/auth.module.ts`:

1. `src/auth/auth.module.ts(2,32): error TS2307: Cannot find module './auth.controller' or its corresponding type declarations.`
2. `src/auth/auth.module.ts(3,49): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.`
3. `src/auth/auth.module.ts(4,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.`

These errors mean the module file is importing from `./auth.controller`, `./auth.service`, and `./auth.repository`, but those files either don't exist or don't exist with the right names.

Looking at the conventions:
- `src/<feature>/<feature>.controller.ts` — but the task says "TS file: `kebab-case.role.ts`"
- So the files should be named: `auth.controller.ts`, `auth.service.ts`, `auth.repository.ts`

Wait, but the errors from `auth.controller.ts` reference `./auth.service` and from `auth.service.ts` reference `./auth.repository`. So the files DO exist with those names (the compiler found them to check them, but the imports within them are failing).

Wait, let me re-read. The compiler says:
- `src/auth/auth.controller.ts(2,31): error TS2307: Cannot find module './auth.service'`
- `src/auth/auth.service.ts(3,32): error TS2307: Cannot find module './auth.repository'`

So the files `auth.controller.ts` and `auth.service.ts` DO exist (the compiler is reporting errors inside them), but `auth.repository.ts` does NOT exist (since `auth.service.ts` can't find `./auth.repository`).

And `auth.module.ts` exists and imports from all three, but can't find them.

Wait, but if `auth.controller.ts` exists (the compiler reports errors inside it), why can't `auth.module.ts` find it? 

Hmm, let me reconsider. The error is `Cannot find module './auth.controller'`. In TypeScript, when you write `import { AuthController } from './auth.controller'`, the module resolution looks for `./auth.controller.ts`, `./auth.controller.tsx`, `./auth.controller.d.ts`, etc.

But wait — the convention says "TS file: `kebab-case.role.ts`". The feature is `auth`, so the files should be `auth.controller.ts`, `auth.service.ts`, `auth.repository.ts`.

Actually wait — if the compiler IS reporting errors inside `src/auth/auth.controller.ts` and `src/auth/auth.service.ts`, that means those files ARE found by the compiler's program. The issue might be that `auth.module.ts` is using a different import path or the files exist but aren't being resolved.

Actually, let me reconsider. In TypeScript with ESM (`"type": "module"`), you might need explicit file extensions in imports. If the module file uses `./auth.controller` without `.js` extension, TypeScript in ESM mode might not resolve it.

Wait, but the other files also import without extensions (`./auth.service` from `auth.controller.ts`, `./auth.repository` from `auth.service.ts`) and those are also failing. So it's consistent — all relative imports without `.js` extensions are failing.

But the task says: "Change nothing the messages do not name." The messages for `auth.module.ts` are about not finding `./auth.controller`, `./auth.service`, and `./auth.repository`. The fix would be to add `.js` extensions to those imports.

But wait — if I add `.js` to the imports in `auth.module.ts`, that only fixes `auth.module.ts`. The other files (`auth.controller.ts`, `auth.service.ts`) also have errors but I'm told to only fix what the messages require of `auth.module.ts`.

Let me re-read the task: "Rewrite `src/auth/auth.module.ts` complete, fixing what these messages require of this file."

So I only need to fix `auth.module.ts`. The errors in that file are:
- Line 2, col 32: Cannot find module './auth.controller'
- Line 3, col 49: Cannot find module './auth.service'  
- Line 4, col 32: Cannot find module './auth.repository'

In ESM mode with TypeScript, you need to use `.js` extensions in relative imports. So the fix is:
- `import { AuthController } from './auth.controller.js'`
- `import { AuthService } from './auth.service.js'`
- `import { AuthRepository } from './auth.repository.js'`

Now, what should the module contain? Based on the conventions:
- A controller is declared by a module (in `controllers`)
- A service, repository are listed in `providers`
- A provider used by another module is `exports`ed

The controller needs the service (to call it), and the service needs the repository. The repository is the only layer that touches the database.

For the module:
- `controllers: [AuthController]`
- `providers: [AuthService, AuthRepository]`
- `exports: [AuthService]` (since the controller uses it, and if other modules need it, it should be exported)

Wait, actually the controller is in the same module, so it can access providers directly. The `exports` is for OTHER modules. Since this is a self-contained auth module, I'll export the service in case other modules need it.

Actually, let me think about what the module needs. The convention says:
- A service, repository or processor is listed in its module's `providers`.
- A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other.
- A controller is declared by a module.

So the module should have:
- `controllers: [AuthController]`
- `providers: [AuthService, AuthRepository]`
- `exports: [AuthService]`

Now, do I need to import `PrismaService` or anything? The convention says the repository is the only layer that touches the database. The repository would use Prisma. But I don't know the exact shape of the repository or what it injects. 

The task says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I can't see the actual content of `auth.repository.ts` or `auth.service.ts` or `auth.controller.ts`. The compiler errors tell me the import paths are wrong, but I don't know the exact class names or what providers they need.

Wait, actually — the compiler DID find `auth.controller.ts` and `auth.service.ts` (it reported errors inside them). So those files exist. The issue is just the import resolution (missing `.js` extension in ESM mode).

For the module, I need to know:
1. The class names — `AuthController`, `AuthService`, `AuthRepository` (PascalCase convention)
2. What providers to list

Let me think about what the controller imports. The error says:
- `src/auth/auth.controller.ts(2,31): Cannot find module 'express'`
- `src/auth/auth.controller.ts(3,29): Cannot find module './auth.service'`
- `src/auth/auth.controller.ts(4,36): Cannot find module './auth.service'`

So the controller imports from `./auth.service` (twice — probably `AuthService` and a type/interface).

The service imports:
- `src/auth/auth.service.ts(3,32): Cannot find module './auth.repository'`

So the service imports from `./auth.repository`.

Now for the module file itself, I just need to get the imports right. The class names follow PascalCase: `AuthController`, `AuthService`, `AuthRepository`.

Let me write the module:

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

Wait, but do I need to import anything for Prisma? The repository would need `PrismaService` or the Prisma client. But that's the repository's concern, not the module's. The module just lists the repository as a provider.

Actually, hmm. If the repository uses `@Injectable()` and injects a Prisma service, that Prisma service would need to be provided. But I don't know if there's a `PrismaService` in this codebase or if the repository instantiates Prisma directly.

The task says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The compiler messages for `auth.module.ts` only complain about the three relative imports not being found. They don't say anything about missing providers or injection tokens. So the fix is just the import paths.

Let me also consider: does the module need `exports`? The convention says "A provider used by another module is exportsed." I don't know if other modules use `AuthService`. But it's a reasonable default for an auth module to export its service. I'll include it.

Actually, wait. Let me re-read the constraint: "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change."

The task says to fix what the compiler messages require of this file. The messages only say the imports can't be found. The fix is to use `.js` extensions. I should keep the module structure minimal — just what's needed.

I'll go with:

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

This should be correct. The `.js` extension is what TypeScript ESM module resolution requires. The module structure follows the conventions (controller in `controllers`, service and repository in `providers`, service exported for other modules).

I don't think I need an ASSUMPTION line here because the fix is straightforward — it's just the import path format. The class names follow the standard PascalCase convention and are derivable from the file names.

Wait, one more thought: could the issue be that `auth.repository.ts` doesn't exist at all? The compiler error in `auth.service.ts` says it can't find `./auth.repository`. But the task says "Change nothing the messages do not name." The messages name `auth.module.ts` as the file to fix. If `auth.repository.ts` doesn't exist, that's a different problem (the file needs to be created), but the task only asks me to fix `auth.module.ts`.

However, for `auth.module.ts` to compile, the import `./auth.repository.js` needs to resolve. If the file doesn't exist, adding `.js` won't help. But the task says to fix what the messages require of THIS file. The message says "Cannot find module './auth.repository'". The fix from this file's perspective is to use the correct import specifier. Whether the target file exists is a separate concern.

I'll proceed with the `.js` extension fix and not add an assumption, since the task is specifically about fixing this file's import syntax.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

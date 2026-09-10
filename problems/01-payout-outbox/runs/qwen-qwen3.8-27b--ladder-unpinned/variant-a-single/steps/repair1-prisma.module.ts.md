# repair1-prisma.module.ts

## reasoning

```
Let me analyze the compiler errors related to `src/prisma/prisma.module.ts`:

1. `src/prisma/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.`

This tells me that `src/prisma/prisma.module.ts` is trying to import from `./prisma.service` but that file doesn't exist or doesn't export what's expected.

Looking at other errors, I can see that other files reference `../prisma/prisma.service` (e.g., `src/payout/payout.repository.ts(4,31)` and `test/payout.spec.ts(4,31)`). This confirms that `src/prisma/prisma.service.ts` should exist and export something (likely a `PrismaService` class).

The task says: "Rewrite `src/prisma/prisma.module.ts` complete, fixing what these messages require of this file."

So I need to fix the import in `prisma.module.ts`. The file is at `src/prisma/prisma.module.ts` and it's importing `./prisma.service` which doesn't exist yet.

Wait - the task says "Change nothing the messages do not name." and "Rewrite `src/prisma/prisma.module.ts` complete, fixing what these messages require of this file."

So I should only fix what's in `src/prisma/prisma.module.ts`. The error is that `./prisma.service` can't be found. 

Looking at the broader context:
- `src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service'`
- `test/payout.spec.ts(4,31): error TS2307: Cannot find module '../src/prisma/prisma.service'`

These tell me that `src/prisma/prisma.service.ts` is expected to exist and export something (likely `PrismaService`).

But my task is ONLY to fix `src/prisma/prisma.module.ts`. The error in that file is:
- Line 2, column 31: Cannot find module `./prisma.service`

The fix for `prisma.module.ts` is to properly import from `./prisma.service`. But if that file doesn't exist, I can't create it (the task says "Change nothing the messages do not name" and only asks me to rewrite `prisma.module.ts`).

Wait, let me re-read: "Rewrite `src/prisma/prisma.module.ts` complete, fixing what these messages require of this file."

So I'm only fixing this one file. The module needs to import `PrismaService` from `./prisma.service`. Since that file is expected to exist (other files reference it), the module should import it properly.

A standard NestJS Prisma module looks like:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

The error is on line 2, column 31, which is the import statement. The fix is to ensure the import is correct. Since `./prisma.service` is the expected path (confirmed by other files referencing `../prisma/prisma.service`), the import path is correct - the file just doesn't exist yet.

But wait - the task says to fix what the messages require of THIS file. The message says `Cannot find module './prisma.service'`. Since I can only change this file, and the file `./prisma.service` is expected to exist (as other files reference it), the correct approach is:

1. Keep the import from `./prisma.service` (it's the right path)
2. Add an `// ASSUMPTION:` comment noting that `./prisma.service` is expected to exist but is not yet created

Actually, let me reconsider. The task says "fixing what these messages require of this file." The message requires that `./prisma.service` resolves. Since I can only change this file, and the file doesn't exist, I should note this with an ASSUMPTION comment.

But actually, looking more carefully - maybe the file exists but has a different name? No, the other errors confirm it should be at `src/prisma/prisma.service.ts` (referenced as `../prisma/prisma.service` from `src/payout/` and `../src/prisma/prisma.service` from `test/`).

So the correct `prisma.module.ts` should import from `./prisma.service` and the assumption is that file will be created separately. The module itself is correctly structured - it just can't compile until `prisma.service.ts` exists.

Let me write the complete file:

```typescript
import { Global, Module } from '@nestjs/common';
// ASSUMPTION: ./prisma.service is expected to exist and export PrismaService; it is referenced by other files but not yet created.
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

This is the standard NestJS Prisma module pattern. It's global so other modules can inject `PrismaService` without importing `PrismaModule` explicitly. It provides and exports `PrismaService`.

The only error in this file is the module resolution for `./prisma.service`, which is an external dependency I can't fix by changing this file alone. The ASSUMPTION comment documents this.
```

## reply

```typescript
import { Global, Module } from '@nestjs/common';
// ASSUMPTION: ./prisma.service is expected to exist and export PrismaService; it is referenced by other files but not yet created.
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

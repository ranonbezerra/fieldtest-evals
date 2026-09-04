# repair2-methodology.repository.ts

## reasoning

```
Let me analyze the compiler errors that pertain to `src/methodology/methodology.repository.ts`:

1. `src/methodology/methodology.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.`
2. `src/methodology/methodology.repository.ts(31,43): error TS7006: Parameter 'tx' implicitly has an 'any' type.`

So I need to:
1. Fix the import path for the Prisma service. Looking at other files, `product.repository.ts` imports from `'../prisma/prisma.service'`. So the correct path should be `'../prisma/prisma.service'` (not `'../prisma.service'`).
2. Fix the implicit `any` type on parameter `tx`. This is in a transaction callback. I need to type it properly.

Let me look at the plan for what this repository should contain:

From the plan:
```ts
// methodology.repository.ts
class MethodologyRepository {
  getActive(): Promise<MethodologyVersion | null>;
  getById(id: number): Promise<MethodologyVersion | null>;
  getRules(versionId: number): Promise<Rule[]>;
  create(data: { version: number; name: string }): Promise<MethodologyVersion>;
  publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new
}
```

Now, the project uses ESM with `"type": "module"` and the compiler messages mention `--moduleResolution` is `node16` or `nodenext`. This means relative imports need explicit file extensions (like `.js`). But wait — the other errors show that files like `product.controller.ts` can't find `'./product.service'` — meaning those files don't exist yet. The errors in `methodology.repository.ts` are specifically about:
1. Wrong import path for prisma service (`'../prisma.service'` should be `'../prisma/prisma.service'`)
2. Implicit `any` on `tx` parameter

Wait, but looking at the other errors more carefully:
- `src/product/product.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service'` — this means the file `src/prisma/prisma.service.ts` also doesn't exist!

But the task says "Change nothing the messages do not name." and I should only fix `src/methodology/methodology.repository.ts`.

The error for my file is:
- Line 2, col 31: Cannot find module `'../prisma.service'`

The correct path based on the project layout should be `'../prisma/prisma.service'` (matching what product.repository.ts uses). Even if that file doesn't exist yet, I should use the correct path. The task says to fix what the messages require of this file — the message says the module `'../prisma.service'` can't be found. The fix is to use the correct path `'../prisma/prisma.service'`.

Actually wait — let me re-read. The error is `Cannot find module '../prisma.service'`. This could mean:
- The file at that path doesn't exist (wrong path), OR
- The file exists but has no type declarations

Looking at `product.repository.ts`, it imports from `'../prisma/prisma.service'` and gets the same "Cannot find module" error. So the prisma service file simply doesn't exist yet in the workspace. But I need to use the correct path.

Given the layout convention (`src/<feature>/<feature>.role.ts`), the prisma service would be at `src/prisma/prisma.service.ts`. So from `src/methodology/methodology.repository.ts`, the relative path would be `'../prisma/prisma.service'`.

But wait — with `node16`/`nodenext` module resolution, I need to add `.js` extension. Let me check: the error on `methodology.service.ts` line 10 says:
```
error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../classification/types.js'?
```

So yes, I need `.js` extensions on relative imports. But the other errors (TS2307 "Cannot find module") don't mention this — they just say the module can't be found. This is because the files simply don't exist yet. But when they do exist, I'll need `.js` extensions.

Hmm, but the task says "fixing what these messages require of this file." The messages for my file are:
1. `Cannot find module '../prisma.service'` — fix the path to `'../prisma/prisma.service.js'` (correct path + ESM extension)
2. `Parameter 'tx' implicitly has an 'any' type` — add a type annotation

Wait, but if I use `'../prisma/prisma.service.js'` and that file doesn't exist, will it still be a TS2307 error? Yes it will. But the task says to fix what the messages require. The message says the module can't be found at `'../prisma.service'`. The correct fix is to use the right path. Whether the file exists or not is a separate concern (other files in the workspace have the same issue).

Actually, let me reconsider. The task says "fixing what these messages require of this file." The message is about a module not being found. The fix is to correct the import path. If the target file doesn't exist, that's not something I can fix in this file (and the task says "Change nothing the messages do not name" — other files aren't named in a way that asks me to create them).

Let me look at what the file should contain based on the plan and write it correctly:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActive() {
    return this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
  }

  async getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  async getRules(versionId: number) {
    return this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } });
  }

  async create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // tx is typed by Prisma as Prisma.TransactionClient
      await tx.methodologyVersion.updateMany({ where: { isActive: true }, data: { isActive: false } });
      await tx.methodologyVersion.update({ where: { id: versionId }, data: { isActive: true } });
    });
  }
}
```

The issue with `tx` being implicitly `any` is that if the `PrismaService` type can't be resolved (because the file doesn't exist), then `$transaction` returns `any` and the callback parameter is untyped. 

But wait — I need to type `tx` explicitly. The Prisma transaction client type is `Prisma.TransactionClient`. I can import it from `@prisma/client`.

Let me write:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActive() {
    return this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
  }

  async getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  async getRules(versionId: number) {
    return this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } });
  }

  async create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.methodologyVersion.updateMany({ where: { isActive: true }, data: { isActive: false } });
      await tx.methodologyVersion.update({ where: { id: versionId }, data: { isActive: true } });
    });
  }
}
```

This should fix both errors:
1. The import path is corrected to `'../prisma/prisma.service.js'` (with proper ESM extension and correct directory)
2. The `tx` parameter is explicitly typed as `Prisma.TransactionClient`

Now, will error #1 still exist because `../prisma/prisma.service.js` doesn't exist? Yes, but that's the same situation as all the other "Cannot find module" errors in the workspace — those files just haven't been created yet. The task asks me to fix what the messages require of *this file*, and the correct import path is the fix I can make here.

Actually, wait. Let me reconsider whether I should add an ASSUMPTION line. The plan says the prisma service is at `src/prisma/prisma.service.ts` (based on the layout pattern). The product.repository.ts already imports from `'../prisma/prisma.service'` (without .js). So the convention in this codebase seems to be that files import without `.js` extension even though it's ESM. But the compiler error TS2835 explicitly says extensions are needed...

Looking more carefully at the errors:
- `methodology.service.ts(10,49): error TS2835` — this one explicitly calls out the missing extension
- `methodology.repository.ts(2,31): error TS2307` — this one just says "cannot find module"

The TS2307 error for my file is specifically about `'../prisma.service'` not being found. The fix is the correct path. Whether or not to add `.js` — the TS2835 error only appears on files that DO have a resolvable target but are missing the extension. For my file, the target doesn't exist at all, so TS2307 is reported instead.

I think the safest approach is to use `'../prisma/prisma.service.js'` since:
1. It's the correct directory path
2. It includes the `.js` extension required by `node16`/`nodenext` resolution
3. When the file is eventually created, it will resolve correctly

Let me finalize my answer.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActive() {
    return this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
  }

  async getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  async getRules(versionId: number) {
    return this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } });
  }

  async create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.methodologyVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      });
    });
  }
}
```

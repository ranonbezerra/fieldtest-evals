# 17-methodology.repository.ts

## reasoning

```
Let me analyze what I need to write for `src/methodology/methodology.repository.ts` based on the PLAN.md.

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

The table `methodology_versions`:
- `id` INT PK AI
- `version` INT UNIQUE NOT NULL
- `name` TEXT NOT NULL
- `is_active` BOOL DEFAULT false
- `created_at` TIMESTAMPTZ DEFAULT now()

The table `rules`:
- `id` INT PK AI
- `methodology_version_id` INT FK NOT NULL
- `ingredient_id` INT FK NOT NULL
- `severity` SEV_ENUM NOT NULL
- `flag` TEXT NOT NULL
- `source_citation` TEXT NOT NULL
- UNIQUE(`methodology_version_id`, `ingredient_id`)

The publish transaction: "set `is_active = false` on the current active row; set `is_active = true` on `versionId`."

From the control flow: "Raise `ConflictError` if `versionId` not found or already active."

Wait, let me re-read. The plan says:
- `ConflictError` | publishing a version that already exists (same integer)

Actually looking more carefully at the errors table:
| `ConflictError` | publishing a version that already exists (same integer) |

And in the control flow for publish:
"Raise `ConflictError` if `versionId` not found or already active."

Wait, but the plan says "Raise `ConflictError` if `versionId` not found or already active." But the errors table says "publishing a version that already exists (same integer)". Let me reconcile these.

Actually, looking at the control flow section:
"1. In a transaction: set `is_active = false` on the current active row; set `is_active = true` on `versionId`. | **Yes** | Raise `ConflictError` if `versionId` not found or already active."

So the repository's `publish` method should:
1. Check if versionId exists (getById) - if not, raise ResourceNotFound? Or ConflictError?

Wait, the plan says "Raise `ConflictError` if `versionId` not found or already active." But the errors table says ResourceNotFound for "version id not found in DB". Let me re-read.

Errors table:
| Raiser | Condition |
|--------|-----------|
| `ResourceNotFound` | product id, profile id, or version id not found in DB |
| `ConflictError` | publishing a version that already exists (same integer) |

So:
- If versionId not found → `ResourceNotFound`
- If versionId already active → `ConflictError`

But the control flow says "Raise `ConflictError` if `versionId` not found or already active." This contradicts the errors table. The errors table is more specific and is the contract. Let me follow the errors table: ResourceNotFound for not found, ConflictError for already active.

Actually wait - re-reading the control flow: "Raise `ConflictError` if `versionId` not found or already active." Hmm, but the errors section says ResourceNotFound for "version id not found in DB". 

I think the control flow note is a bit loose. The errors table is the definitive contract. So:
- versionId not found → `ResourceNotFound`
- versionId already active → `ConflictError`

Now for the repository, the plan says the repository is `@Injectable()` and uses Prisma. Let me write it.

The file path is `src/methodology/methodology.repository.ts`.

Let me think about what the Prisma models would be called. Based on the schema:
- `methodology_versions` → Prisma model likely `MethodologyVersion` (with `@@map("methodology_versions")`)
- `rules` → Prisma model likely `Rule` (with `@@map("rules")`)

The Prisma client would be injected. In NestJS + Prisma, typically you inject `PrismaService`.

Let me look at the conventions:
- `controller` validates input and calls the service. Zero business logic.
- `service` holds the logic. Zero raw SQL, zero Prisma client calls.
- `repository` is the only layer that touches the database.

So the repository directly uses Prisma.

For the publish transaction, I need to:
1. Use `prisma.$transaction` 
2. Set `is_active = false` on current active
3. Set `is_active = true` on the target versionId

Let me write the file:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// Wait, where is PrismaService? The plan doesn't explicitly name it.
```

Hmm, the plan doesn't mention a `PrismaService` file. But in NestJS + Prisma, you need something to inject. The convention says "repository is the only layer that touches the database." So I need a Prisma client instance.

Looking at the manifest, there's no `src/prisma.service.ts` listed. But the plan does say "Prisma as the ORM, PostgreSQL as the database" in the conventions.

I'll need to assume there's a PrismaService or similar that provides the Prisma client. Since it's not in the manifest, I'll use `PrismaService` from a common location. Actually, let me think about this differently.

The plan's manifest doesn't list a prisma.service.ts, but it's implied by the stack (NestJS + Prisma). The most defensible reading is that there's a `PrismaService` that wraps the `PrismaClient`. I'll import it from `'../prisma.service'` which is the conventional NestJS location for a shared service.

Actually, I should mark this as an assumption since it's not explicitly in the plan.

Let me also think about the domain errors. The plan says:
```ts
export class ResourceNotFound extends Error { code = 'resource_not_found'; }
export class ConflictError      extends Error { code = 'conflict'; }
```

These are in `src/classification/types.ts`. The repository would import them from there.

Wait, but the plan says the methodology.repository.ts "reads: -" (no dependencies listed). That's odd. Let me re-read the manifest entry:

```
src/methodology/methodology.repository.ts | reads: - | Prisma queries + publish transaction
```

So it has no explicit reads? That seems wrong since it needs to import PrismaService and the error classes. But maybe the "reads" column just means it doesn't read other feature files specifically (the PrismaService is infrastructure, and the error types are shared). I'll include the necessary imports.

Actually, looking more carefully at the manifest, the "reads" field seems to indicate which other project files this file depends on. The methodology.repository.ts having "reads: -" might mean it only depends on external packages (NestJS, Prisma) and shared infrastructure. But it still needs to import error classes for the publish transaction.

Let me just write what makes sense:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ResourceNotFound, ConflictError } from '../classification/types';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActive() {
    return this.prisma.methodologyVersion.findFirst({ where: { is_active: true } });
  }

  async getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  async getRules(versionId: number) {
    return this.prisma.rule.findMany({ where: { methodology_version_id: versionId } });
  }

  async create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      throw new ResourceNotFound();
    }
    if (version.is_active) {
      throw new ConflictError();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.methodologyVersion.updateMany({
        where: { is_active: true },
        data: { is_active: false },
      });
      await tx.methodologyVersion.update({
        where: { id: versionId },
        data: { is_active: true },
      });
    });
  }
}
```

Wait, I need to think about the Prisma model naming. The table is `methodology_versions` mapped from a model. In Prisma, the convention would be:

```prisma
model MethodologyVersion {
  id        Int      @id @default(autoincrement())
  version   Int      @unique
  name      String
  is_active Boolean  @default(false) @map("is_active")
  created_at DateTime @default(now()) @map("created_at")
  
  @@map("methodology_versions")
}
```

So in the Prisma client, it would be `this.prisma.methodologyVersion`.

For rules:
```prisma
model Rule {
  id                     Int   @id @default(autoincrement())
  methodology_version_id Int   @map("methodology_version_id")
  ingredient_id          Int   @map("ingredient_id")
  severity               Severity
  flag                   String
  source_citation        String @map("source_citation")
  
  @@unique([methodology_version_id, ingredient_id])
  @@map("rules")
}
```

So `this.prisma.rule`.

Now, about the `PrismaService` - since it's not in the manifest, I need to make an assumption. In a typical NestJS + Prisma setup, you'd have a `PrismaService` that extends `PrismaClient`. The conventional location would be `src/prisma.service.ts`.

Let me also think about whether the error classes should be imported. The plan puts them in `src/classification/types.ts`. The methodology repository needs to throw them in the `publish` method. So I'll import from there.

Actually wait - re-reading the plan more carefully about the errors:

The plan says errors are "raised by services, mapped to the envelope by a global exception filter in main.ts". So maybe the repository should throw them and the service catches/re-raises? Or the repository throws directly?

Looking at the repository interface: `publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new`

And the control flow says the publish logic (including error raising) is part of the repository's transaction. The service just calls `publish` and then `rescoreAll`. So the repository does the validation and throws.

I'll keep the error throwing in the repository's publish method since that's where the transaction logic lives and the plan explicitly places the "Raise ConflictError" note in the repository's publish step.

Let me finalize my file. I need to be careful about:
1. The Prisma model names (camelCase for the client access)
2. The column name mappings (snake_case in DB, but Prisma uses the model field names which could be camelCase or snake_case depending on how they're defined)

Looking at the plan's table definitions, it uses `is_active`, `methodology_version_id`, etc. In Prisma, if you use `@map("is_active")` the field in the model would be `isActive` (camelCase). But if you don't use `@map` and just name the field `is_active`, it stays as-is.

The convention says "Table and column: `snake_case` (via Prisma `@map`/`@@map`)." This means the DB columns are snake_case, but the Prisma model fields would be camelCase with `@map` to snake_case.

So:
- `is_active` in DB → `isActive` in Prisma model (with `@map("is_active")`)
- `methodology_version_id` in DB → `methodologyVersionId` in Prisma model (with `@map("methodology_version_id")`)
- `source_citation` in DB → `sourceCitation` in Prisma model (with `@map("source_citation")`)
- `created_at` in DB → `createdAt` in Prisma model (with `@map("created_at")`)

So in the Prisma client:
- `this.prisma.methodologyVersion.findFirst({ where: { isActive: true } })`
- `this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } })`

Let me write the final version:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ResourceNotFound, ConflictError } from '../classification/types';

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
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      throw new ResourceNotFound();
    }
    if (version.isActive) {
      throw new ConflictError();
    }

    await this.prisma.$transaction(async (tx) => {
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

I need to add the assumption comment about PrismaService since it's not in the manifest. Let me add it at the import line.

Actually, let me reconsider. The plan says "Prisma as the ORM" and the repository is "the only layer that touches the database." In NestJS, you need to inject the Prisma client somehow. The most standard approach is a `PrismaService`. Since it's infrastructure and not a feature file, it makes sense it wouldn't be in the feature manifest. I'll mark it as an assumption to be safe.

One more thought: should `getActive()` use `findFirst` or a unique constraint? Since `is_active` is not unique (well, by convention only one should be active), `findFirst` is correct.

I think this is complete. Let me write the final version.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService is a shared infrastructure provider (src/prisma.service.ts) wrapping PrismaClient; not listed in the feature manifest but required by the stack (NestJS + Prisma) and the layering rule that repositories are the only DB-talking layer.
import { PrismaService } from '../prisma.service';
import { ResourceNotFound, ConflictError } from '../classification/types';

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
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      throw new ResourceNotFound();
    }
    if (version.isActive) {
      throw new ConflictError();
    }

    await this.prisma.$transaction(async (tx) => {
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

# 16-methodology.service.ts

## reasoning

```
Let me analyze what I need to write for `src/methodology/methodology.service.ts`.

From the PLAN.md:

**Service signature:**
```ts
class MethodologyService {
  publish(versionId: number): Promise<void>;   // triggers rescoreAll
}
```

**Control flow for `publish(versionId)`:**
1. In a transaction: set `is_active = false` on the current active row; set `is_active = true` on `versionId`. Raise `ConflictError` if `versionId` not found or already active.
2. After commit: call `rescoreAll(versionId)`.

**Repository interface:**
```ts
class MethodologyRepository {
  getActive(): Promise<MethodologyVersion | null>;
  getById(id: number): Promise<MethodologyVersion | null>;
  getRules(versionId: number): Promise<Rule[]>;
  create(data: { version: number; name: string }): Promise<MethodologyVersion>;
  publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new
}
```

So the repository already has a `publish(versionId: number): Promise<void>` method that is transactional. The service calls it, then calls `rescoreAll`.

Wait, let me re-read the control flow:

> | 1. In a transaction: set `is_active = false` on the current active row; set `is_active = true` on `versionId`. | **Yes** | Raise `ConflictError` if `versionId` not found or already active. |
> | 2. After commit: call `rescoreAll(versionId)`. | No | Can run outside the publish transaction. |

And the repository has `publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new`

So the service's `publish` method should:
1. Call `this.methodologyRepository.publish(versionId)` — this handles the transaction (clear old, set new)
2. Then call `this.classificationService.rescoreAll(versionId)`

But wait — the plan says "Raise `ConflictError` if `versionId` not found or already active." Where does this check happen? Looking at the repository interface, `publish(versionId: number): Promise<void>` is described as "transactional: clear old is_active, set new". The ConflictError raising could be in the repository or in the service.

Looking at the error table:
| Raiser | Condition |
|--------|-----------|
| `ConflictError` | publishing a version that already exists (same integer) |

Hmm, it says "publishing a version that already exists (same integer)". That's a different condition than what the control flow says. The control flow says "Raise `ConflictError` if `versionId` not found or already active."

Let me think about where to put the checks. The service should:
1. Check if versionId exists → if not, raise ResourceNotFound
2. Check if it's already active → if so, raise ConflictError
3. Call repository.publish(versionId) (the transactional swap)
4. Call classificationService.rescoreAll(versionId)

Actually, looking more carefully at the repository: `publish(versionId: number): Promise<void>` — this is described as doing the transactional work. The service needs to validate before calling it, or the repository does validation internally.

Given the layer rules: "service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database."

The service should do the validation logic (checking existence, checking if already active) and then call the repository's publish method for the actual transactional DB work.

But wait — `getById` is on the repository. So the service would:
1. Call `this.methodologyRepository.getById(versionId)` → if null, raise ResourceNotFound
2. If the returned version has `is_active === true`, raise ConflictError
3. Call `this.methodologyRepository.publish(versionId)` → transactional swap
4. Call `this.classificationService.rescoreAll(versionId)`

Let me also check what imports I need:
- `Injectable` from `@nestjs/common`
- `MethodologyRepository` from `./methodology.repository`
- `ClassificationService` from `../classification/classification.service`
- Error classes from `../classification/types` (ResourceNotFound, ConflictError)

Looking at the types file path: `src/classification/types.ts` — this is where ResourceNotFound and ConflictError are defined.

Now for the file structure:
- `src/methodology/methodology.service.ts`

Let me write it:

```ts
import { Injectable } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository';
import { ClassificationService } from '../classification/classification.service';
import { ResourceNotFound, ConflictError } from '../classification/types';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly methodologyRepository: MethodologyRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async publish(versionId: number): Promise<void> {
    const version = await this.methodologyRepository.getById(versionId);
    if (!version) {
      throw new ResourceNotFound(`Methodology version ${versionId} not found`);
    }
    if (version.is_active) {
      throw new ConflictError(`Methodology version ${versionId} is already active`);
    }

    await this.methodologyRepository.publish(versionId);
    await this.classificationService.rescoreAll(versionId);
  }
}
```

Wait, let me check the naming conventions. The plan says "Class: `PascalCase`" and "TS file: `kebab-case.role.ts`". The class would be `MethodologyService`.

Let me double-check the error messages. The plan says:
- `message` is developer-facing English.
- For ResourceNotFound: "product id, profile id, or version id not found in DB"
- For ConflictError: "publishing a version that already exists (same integer)"

Hmm, the ConflictError condition in the error table says "publishing a version that already exists (same integer)" but the control flow says "Raise `ConflictError` if `versionId` not found or already active."

I think the control flow is more specific and authoritative for the implementation. The error table is a summary. Let me go with:
- If version not found → ResourceNotFound
- If version already active → ConflictError

This matches the control flow section which is the detailed spec.

Let me also verify: does the plan mention any other methods on MethodologyService? Looking at the signature:
```ts
class MethodologyService {
  publish(versionId: number): Promise<void>;   // triggers rescoreAll
}
```

Only `publish`. Good.

One more thing: the plan says the file reads:
- `src/methodology/methodology.repository.ts`
- `src/classification/classification.service.ts`

And for the errors, they come from `src/classification/types.ts`. That's not explicitly in the "reads" for this file in the manifest, but it's needed. Let me check... The manifest says:

```
src/methodology/methodology.service.ts | reads: src/methodology/methodology.repository.ts, src/classification/classification.service.ts | publish (tx) then rescoreAll
```

It doesn't list `src/classification/types.ts` as a read. But the errors are defined there. I'll import them since they're needed. The manifest's "reads" is a summary, not an exhaustive list of imports.

Actually, I should be careful. Let me re-read: "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name."

The errors ARE named in the plan (in section 3, Types and signatures), and they're raised by this service per the control flow. So importing them is correct.

I'm satisfied with my implementation. Let me finalize it.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository';
import { ClassificationService } from '../classification/classification.service';
import { ResourceNotFound, ConflictError } from '../classification/types';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly methodologyRepository: MethodologyRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async publish(versionId: number): Promise<void> {
    const version = await this.methodologyRepository.getById(versionId);
    if (!version) {
      throw new ResourceNotFound(`Methodology version ${versionId} not found`);
    }
    if (version.is_active) {
      throw new ConflictError(`Methodology version ${versionId} is already active`);
    }

    await this.methodologyRepository.publish(versionId);
    await this.classificationService.rescoreAll(versionId);
  }
}
```

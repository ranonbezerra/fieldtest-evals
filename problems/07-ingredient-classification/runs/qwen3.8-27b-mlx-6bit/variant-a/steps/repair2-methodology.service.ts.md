# repair2-methodology.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/methodology/methodology.service.ts`:

1. `src/methodology/methodology.service.ts(8,39): error TS2307: Cannot find module './methodology.repository' or its corresponding type declarations.`
2. `src/methodology/methodology.service.ts(9,39): error TS2307: Cannot find module '../classification/classification.service' or its corresponding type declarations.`
3. `src/methodology/methodology.service.ts(10,49): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../classification/types.js'?`

So the issues are:
1. Import of `./methodology.repository` — needs `.js` extension for ESM/node16 resolution
2. Import of `../classification/classification.service` — needs `.js` extension for ESM/node16 resolution
3. Import of `../classification/types` — needs `.js` extension (the error says "Did you mean '../classification/types.js'?")

The fix is to add `.js` extensions to all relative imports in this file. The modules themselves may not exist yet (hence the TS2307 errors), but my job is only to fix what the compiler messages require of THIS file. Adding `.js` extensions fixes the TS2835 error, and the TS2307 errors for `./methodology.repository` and `../classification/classification.service` will remain if those files don't exist — but the task says "Change nothing the messages do not name." The messages DO name these imports, so I need to fix them. But the TS2307 errors mean the modules can't be found — that's because the files don't exist yet. I can't create them; I'm only rewriting `methodology.service.ts`.

Wait, let me re-read the task: "Rewrite `src/methodology/methodology.service.ts` complete, fixing what these messages require of this file."

So I need to fix the imports in this file. The TS2307 errors for `./methodology.repository` and `../classification/classification.service` are because those files don't exist yet. But the TS2835 error for `../classification/types` is specifically about the missing `.js` extension. 

For consistency and to fix all three errors in this file, I should add `.js` extensions to all relative imports. The TS2307 errors will still exist if the target files don't exist, but at least the import paths will be correct once those files are created.

Actually wait - the TS2307 errors say "Cannot find module" which means the file doesn't exist. Adding `.js` won't fix that if the file truly doesn't exist. But the TS2835 error is specifically about the extension requirement. Let me think about this differently.

The project uses ESM with `"type": "module"` and `--moduleResolution` is `node16` or `nodenext`. In this mode, relative imports MUST have explicit file extensions (`.js`). So:

- `import { MethodologyRepository } from './methodology.repository'` should be `import { MethodologyRepository } from './methodology.repository.js'`
- `import { ClassificationService } from '../classification/classification.service'` should be `import { ClassificationService } from '../classification/classification.service.js'`
- `import { ConflictError, ResourceNotFound } from '../classification/types'` should be `import { ConflictError, ResourceNotFound } from '../classification/types.js'`

The TS2835 error only fires on the `types` import because that file DOES exist (we can see it in the reference). The other two files don't exist yet, so they get TS2307 instead of TS2835. But once those files are created, they'd get TS2835 too if they don't have `.js` extensions.

So the correct fix is to add `.js` to all three relative imports. This fixes the TS2835 immediately and ensures the other two will work once their target files are created.

Now let me write the complete file based on the PLAN:

From the plan:
- `MethodologyService.publish(versionId)` — calls repository publish (which is transactional), then calls `ClassificationService.rescoreAll(versionId)`
- Raises `ResourceNotFound` if version not found, `ConflictError` if already active
- "Publish before re-score" ordering

Let me look at what the repository interface says:
```ts
class MethodologyRepository {
  getActive(): Promise<MethodologyVersion | null>;
  getById(id: number): Promise<MethodologyVersion | null>;
  getRules(versionId: number): Promise<Rule[]>;
  create(data: { version: number; name: string }): Promise<MethodologyVersion>;
  publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new
}
```

And the classification service:
```ts
class ClassificationService {
  classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse>;
  rescoreAll(versionId: number): Promise<void>;
}
```

So the methodology service:
1. `publish(versionId)`: call `this.repository.publish(versionId)` (which handles the transaction and raises errors internally? Or does the service raise them?)

Looking at the plan's control flow:
> 1. In a transaction: set `is_active = false` on the current active row; set `is_active = true` on `versionId`. | **Yes** | Raise `ConflictError` if `versionId` not found or already active.

The repository's `publish` is described as "transactional: clear old is_active, set new". The errors could be raised by either the repository or the service. Since the plan says the service holds the logic and the repository is just DB access, I think the service should check first (getById) and raise errors, then call repository.publish.

Actually, re-reading the layers convention: "service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database."

So the service should:
1. Call `this.repository.getById(versionId)` to check existence
2. If not found, raise `ResourceNotFound`
3. Check if already active (from the getById result)
4. If already active, raise `ConflictError`
5. Call `this.repository.publish(versionId)` for the transactional swap
6. Call `this.classificationService.rescoreAll(versionId)`

Wait, but the repository's `publish` is described as transactional. Maybe the service does the check and the repository just does the DB work. That makes sense.

Let me also consider: the `create` method in the service? The plan's controller has `POST /methodologies` which creates a version. But the service signature only shows `publish`. Let me re-check...

The plan says:
```ts
class MethodologyService {
  publish(versionId: number): Promise<void>;   // triggers rescoreAll
}
```

Only `publish` is in the service. The `create` might be handled directly by the controller calling the repository, or maybe it's not part of this task. Since I'm only fixing compilation errors in the service file, I'll stick to what the plan specifies.

Actually wait, looking more carefully at the controller endpoints:
- `POST /methodologies` → creates a version
- `POST /methodologies/:id/publish` → publishes

The service only has `publish`. The create might be done in the controller or there might be a create method I'm missing. But since the plan only shows `publish` in the service, I'll go with that.

Let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository.js';
import { ClassificationService } from '../classification/classification.service.js';
import { ConflictError, ResourceNotFound } from '../classification/types.js';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly repository: MethodologyRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async publish(versionId: number): Promise<void> {
    const version = await this.repository.getById(versionId);
    if (!version) {
      throw new ResourceNotFound(`Methodology version ${versionId} not found`);
    }
    if (version.isActive) {
      throw new ConflictError(`Methodology version ${versionId} is already active`);
    }

    await this.repository.publish(versionId);
    await this.classificationService.rescoreAll(versionId);
  }
}
```

This should be correct. Let me verify against all the compiler errors for this file:
1. Line 8 (was `./methodology.repository`) → now `./methodology.repository.js` ✓
2. Line 9 (was `../classification/classification.service`) → now `../classification/classification.service.js` ✓  
3. Line 10 (was `../classification/types`) → now `../classification/types.js` ✓

The TS2307 errors for the first two will persist until those files are created, but the import paths are now correct per ESM/node16 resolution. The TS2835 for types is fully resolved since that file exists.

I think this is complete and correct.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository.js';
import { ClassificationService } from '../classification/classification.service.js';
import { ConflictError, ResourceNotFound } from '../classification/types.js';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly repository: MethodologyRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async publish(versionId: number): Promise<void> {
    const version = await this.repository.getById(versionId);
    if (!version) {
      throw new ResourceNotFound(`Methodology version ${versionId} not found`);
    }
    if (version.isActive) {
      throw new ConflictError(`Methodology version ${versionId} is already active`);
    }

    await this.repository.publish(versionId);
    await this.classificationService.rescoreAll(versionId);
  }
}
```

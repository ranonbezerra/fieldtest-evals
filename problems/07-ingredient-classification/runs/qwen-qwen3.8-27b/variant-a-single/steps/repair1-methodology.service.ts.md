# repair1-methodology.service.ts

## reasoning

```
Let me analyze the compiler errors to understand what's wrong with `src/methodologies/methodology.service.ts`.

Looking at the errors, none of them directly reference `src/methodologies/methodology.service.ts` by filename. Let me re-read the task:

"src/methodologies/methodology.service.ts does not compile.
```

## reply

Looking at the errors, none directly reference `src/methodologies/methodology.service.ts` by filename. The errors are in:
- `src/profiles/profile.repository.ts` - missing Prisma client properties (`profile`, `profileModifier`)
- `src/profiles/profile.service.ts` - `Severity` not exported from `@prisma/client`
- `test/classifications.spec.ts` - `PrismaClient` and `Prisma` not exported from `@prisma/client`
- `test/methodologies.spec.ts` - `PrismaClient` not exported from `@prisma/client`

The common thread is that `@prisma/client` is not generating proper types. This means the Prisma client hasn't been generated or the schema doesn't match what's expected. However, the task says to rewrite `src/methodologies/methodology.service.ts` to fix what these messages require of this file.

Let me look at what `classification.ts` imports from `methodology.service.ts`:
- `DISCLAIMER` (a constant)
- `MethodologyService` (a class)

From `classification.ts` usage:
- `this.methodologies` is injected (type `MethodologyService`)
- It's used alongside `MethodologyRepository`, `ProductRepository`, `ProfileService`, `ClassificationComputer`

The errors in `profile.service.ts` line 2: `Module '"@prisma/client"' has no exported member 'Severity'` - this means the Prisma client hasn't been generated with the proper schema.

But wait - the task says to rewrite `methodology.service.ts` to fix what these messages require of **this file**. The errors don't directly point to this file. Let me reconsider.

Perhaps the issue is that `methodology.service.ts` currently imports `Severity` from `@prisma/client` (similar to how `profile.service.ts` does), and the generated Prisma client doesn't export it because the schema uses an enum that hasn't been properly set up, OR the Prisma client simply hasn't been generated.

Actually, re-reading more carefully: the task says "These are the compiler's exact messages for the whole workspace." The file `methodology.service.ts` "does not compile" - but no error lines point to it. This is confusing.

Wait - maybe the file currently doesn't exist or is empty, and the errors in other files are *caused by* the missing exports from this file. Let me look at what other files import from it:

From `classification.ts`:
```ts
import { DISCLAIMER, MethodologyService } from '../methodologies/methodology.service.js';
```

If `methodology.service.ts` is missing or broken, that would cause `classification.ts` to fail, which would cascade. But the errors shown don't include errors in `classification.ts` either.

Let me re-read the errors more carefully. The key issue is:
1. `@prisma/client` doesn't export `PrismaClient`, `Prisma`, or `Severity`

This strongly suggests the Prisma client hasn't been generated. But I can't generate it - I can only fix the source file.

Actually, I think the real issue is simpler. The task says to rewrite `methodology.service.ts`. The errors in other files are the *symptom* - they show what the workspace looks like. My job is to write a correct `methodology.service.ts` that:
1. Exports `DISCLAIMER` and `MethodologyService` (as `classification.ts` expects)
2. Doesn't import `Severity` from `@prisma/client` (since that's causing errors elsewhere, and the Prisma client isn't generating that export)

For the `Severity` type, I should define it locally or import it from where it's actually available. Looking at `classification.ts`, it imports `Severity` from `@prisma/client` on line 3. But the error says `@prisma/client` has no exported member `Severity`.

So the Prisma client hasn't been generated properly. Since I can only fix `methodology.service.ts`, I should:
1. Define `Severity` locally (or use a string union type) instead of importing from `@prisma/client`
2. Export `DISCLAIMER` and `MethodologyService`

Let me think about what `MethodologyService` needs to do based on the variant spec and usage:
- It manages methodology versions
- Publishing a new version triggers re-scoring
- It needs to interact with `MethodologyRepository`

From the usage in `classification.ts`:
- `MethodologyService` is injected into `ClassificationService`
- It's used as `this.methodologies` but I don't see it called directly in the shown code (the `classify` method uses `methodologyRepository` directly)

Wait, looking more carefully at `classification.ts`, `this.methodologies` is injected but never actually called in the shown code. So `MethodologyService` might be needed for other operations (publishing, etc.) that aren't shown in `classification.ts`.

Let me look at what the repository exports (from the import in `classification.ts`):
```ts
import {
  MethodologyRepository,
  StoredClassification,
  StoredFinding,
} from '../methodologies/methodology.repository.js';
```

So `MethodologyRepository` is a separate file. `MethodologyService` would be the service layer that uses the repository.

Based on the variant spec:
- Rules grouped under immutable methodology versions
- Publishing a new methodology version triggers idempotent re-scoring
- Results from previous versions remain retrievable

The `MethodologyService` should:
- Manage active version
- Handle publishing new versions
- Trigger re-scoring on publish

For the `Severity` type issue: since `@prisma/client` doesn't export it (client not generated), I need to define it locally. But wait - `classification.ts` also imports it from `@prisma/client`. If I fix `methodology.service.ts` to not import from `@prisma/client`, that won't fix `classification.ts`.

Hmm, but the task says "fixing what these messages require of this file." So I should only fix what's needed in `methodology.service.ts` itself. The other files' errors are there but I'm told to only change what the messages name for this file.

Actually, I think the key insight is: the Prisma client IS generated, but the schema might not have an enum called `Severity` - it might be a string field instead. Or the client isn't generated at all.

Given the constraint that I can only modify `methodology.service.ts`, and the errors show `@prisma/client` doesn't export `Severity`, `PrismaClient`, or `Prisma`, the safest approach is:

1. Don't import anything from `@prisma/client` in this file
2. Define `Severity` as a local type
3. Export `DISCLAIMER` as a string constant
4. Export `MethodologyService` as an injectable class

Let me write this:

```ts
import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { MethodologyRepository } from './methodology.repository.js';

export type Severity = 'banned' | 'restricted' | 'watch';

export const DISCLAIMER =
  'This classification is informational only and does not constitute safety advice. ' +
  'Always consult a qualified professional before use.';

@Injectable()
export class MethodologyService {
  constructor(private readonly repository: MethodologyRepository) {}

  async getActiveVersion(): Promise<string | null> {
    const active = await this.repository.findActive();
    return active?.id ?? null;
  }

  async publish(version: string, rules: Array<{
    ingredientId: string;
    severity: Severity;
    flag: string;
    source: string;
  }>): Promise<string> {
    // Create new immutable version
    const id = await this.repository.createVersion(version, rules);
    // Set as active
    await this.repository.setActive(id);
    // Trigger idempotent re-scoring
    await this.rescoreAll();
    return id;
  }

  async rescoreAll(): Promise<void> {
    // Idempotent re-scoring of affected products
    const products = await this.repository.findProducts();
    const active = await this.repository.findActive();
    if (!active) return;
    for (const product of products) {
      await this.repository.upsertResult(product.id, active.id, []);
    }
  }

  async getVersion(version: string) {
    return this.repository.find(version);
  }

  async getActiveVersionObject() {
    return this.repository.findActive();
  }
}
```

Wait, but I'm guessing at the repository interface. Let me look at what's used in `classification.ts`:

```ts
this.methodologyRepository.findResult(product.id, active.id)
this.methodologyRepository.findActive()
this.methodologyRepository.find(version)
```

And the types:
```ts
StoredClassification - has: productId, methodologyVersionId, findings (array of StoredFinding), confidence, disclaimer
StoredFinding - has: ingredient, status ('flagged' | 'clear' | 'unknown'), severity, flag, source
```

So `MethodologyRepository` has at least:
- `findResult(productId: string, versionId: string): Promise<StoredClassification | null>`
- `findActive(): Promise<{ id: string; version: string } | null>`
- `find(version: string): Promise<{ id: string; version: string } | null>`

Now for `MethodologyService`, based on the variant requirements:
- Publishing a new methodology version triggers idempotent re-scoring of affected products
- Results from previous versions remain retrievable

The service needs to:
1. Create a new version with its rules
2. Mark it as active
3. Trigger re-scoring

But I'm not sure about the exact repository interface for creating versions and re-scoring. Since I can only see what's used in `classification.ts`, I need to be careful.

Actually, let me reconsider the problem. The task says the file "does not compile" and gives me all workspace errors. The errors don't point to this file directly. Perhaps the file is currently empty or missing, causing import resolution failures in files that import from it. But those errors would show up as "cannot find module" errors, not the ones listed.

OR - perhaps the file exists but has its own errors that aren't shown because the compiler stopped before reaching them, or the errors shown are the only ones in the workspace.

I think the most likely scenario is:
- The file exists but is broken/empty
- The errors shown are from other files that are broken for different reasons (Prisma client not generated)
- My job is to write a correct version of this file that properly exports what's needed

Given the constraints, let me write a clean `methodology.service.ts` that:
1. Exports `DISCLAIMER` (string)
2. Exports `MethodologyService` (Injectable class)
3. Doesn't import from `@prisma/client` (since that's broken)
4. Uses the repository for data access
5. Implements the publishing + re-scoring logic

For the `Severity` type, since it's also imported from `@prisma/client` in `classification.ts` and that's broken too, but I can only fix this file... I'll define it here and export it, so at least this file is self-contained.

Actually wait - I just realized something. Let me re-read the task: "Rewrite `src/methodologies/methodology.service.ts` complete, fixing what these messages require of this file."

The messages that relate to this file indirectly:
- The `Severity` import from `@prisma/client` is broken (shown in profile.service.ts)
- If methodology.service.ts also imports Severity from @prisma/client, it would have the same issue

So the fix for this file is: don't import Severity from @prisma/client, define it locally.

Let me also think about what the `MethodologyService` needs to expose based on usage in `classification.ts`. Looking at the code again:

```ts
constructor(
  private readonly methodologies: MethodologyService,
  ...
)
```

It's injected but I don't see it used in the shown `classify` or `retrieve` methods. It might be used in other methods not shown, or it might be there for the publishing workflow.

Let me write a reasonable implementation:


```ts
import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { MethodologyRepository, StoredClassification, StoredFinding } from './methodology.repository.js';

/** Severity levels for ingredient findings. */
export type Severity = 'banned' | 'restricted' | 'watch';

/**
 * Standard disclaimer attached to every classification result.
 * No binary safe/toxic determination is ever made.
 */
export const DISCLAIMER =
  'This result is informational only and does not constitute a safety determination. ' +
  'Ingredients flagged here may be subject to regulatory restrictions or family-specific ' +
  'concerns. Consult a qualified professional for personalized advice.';

export interface RuleEntry {
  ingredientId: string;
  severity: Severity;
  flag: string;
  source: string;
}

/**
 * Manages immutable methodology versions and the publish workflow.
 * Publishing a new version activates it and triggers idempotent
 * re-scoring of all products so stored results reflect the new rules.
 * Results from prior versions remain retrievable.
 */
@Injectable()
export class MethodologyService {
  constructor(private readonly repository: MethodologyRepository) {}

  /** Returns the currently active version, or null if none is published. */
  async getActive(): Promise<{ id: string; version: string } | null> {
    return this.repository.findActive();
  }

  /** Retrieves a specific version by its version string. */
  async getVersion(version: string): Promise<{ id: string; version: string } | null> {
    const found = await this.repository.find(version);
    if (!found) {
      throw Errors.notFound('Methodology version', { version });
    }
    return found;
  }

  /**
   * Publishes a new immutable methodology version, activates it, and
   * triggers idempotent re-scoring of all affected products.
   * Re-publishing the same version string is idempotent.
   */
  async publish(version: string, rules: RuleEntry[]): Promise<string> {
    const existing = await this.repository.find(version);
    if (existing) {
      // Already published; just ensure it is active and re-score.
      await this.repository.setActive(existing.id);
      await this.rescoreAll();
      return existing.id;
    }
    const id = await this.repository.createVersion(version, rules);
    await this.repository.setActive(id);
    await this.rescoreAll();
    return id;
  }

  /**
   * Idempotent re-scoring: for every product, computes and stores a
   * base classification under the active version. Overwriting an
   * existing stored result for the same (product, version) pair is
   * safe and produces identical output.
   */
  async rescoreAll(): Promise<void> {
    const active = await this.repository.findActive();
    if (!active) return;

    const products = await this.repository.findProducts();
    const rules = await this.repository.findRules(active.id);
    const ruleMap = new Map<string, RuleEntry>();
    for (const rule of rules) {
      ruleMap.set(rule.ingredientId, rule);
    }

    for (const product of products) {
      const findings: StoredFinding[] = product.ingredients.map((rawName: string) => {
        const canonical = this.resolveIngredient(rawName);
        if (!canonical) {
          return {
            ingredient: rawName,
            status: 'unknown' as const,
            severity: null,
            flag: null,
            source: null,
          };
        }
        const rule = ruleMap.get(canonical);
        if (rule) {
          return {
            ingredient: canonical,
            status: 'flagged' as const,
            severity: rule.severity,
            flag: rule.flag,
            source: rule.source,
          };
        }
        return {
          ingredient: canonical,
          status: 'clear' as const,
          severity: null,
          flag: null,
          source: null,
        };
      });

      const recognized = findings.filter((f) => f.status !== 'unknown').length;
      const confidence = findings.length === 0 ? 1 : recognized / findings.length;

      await this.repository.upsertResult(product.id, active.id, {
        productId: product.id,
        methodologyVersionId: active.id,
        findings,
        confidence,
        disclaimer: DISCLAIMER,
      });
    }
  }

  /**
   * Resolves a raw ingredient name to its canonical form using
   * normalization (lowercase, strip accents) and synonym lookup.
   */
  private resolveIngredient(rawName: string): string | null {
    const normalized = this.normalize(rawName);
    const canonical = this.repository.findCanonicalByNormalized?.(normalized);
    // The repository handles synonym/typo resolution; if no match, return null.
    // This is a synchronous call in the current design; for async repos,
    // the caller would await.
    return canonical ?? null;
  }

  private normalize(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim();
  }
}
```

Hmm, but I'm making a lot of assumptions about the repository interface. Let me look at what's actually used in `classification.ts` to see what methods the repository definitely has:

1. `this.methodologyRepository.findResult(product.id, active.id)` → returns `StoredClassification | null` (or throws)
2. `this.methodologyRepository.findActive()` → returns `{ id: string; version: string } | null`
3. `this.methodologyRepository.find(version)` → returns `{ id: string; version: string } | null`

And the types used:
- `StoredClassification`: `{ productId: string; methodologyVersionId: string; findings: StoredFinding[]; confidence: number; disclaimer: string }`
- `StoredFinding`: `{ ingredient: string; status: 'flagged' | 'clear' | 'unknown'; severity: Severity | null; flag: string | null; source: string | null }`

Wait, looking at `StoredFinding` usage in `classification.ts`:
```ts
const modifier = profileModifiers.get(finding.ingredient);
const active = modifier ?? (finding.status === 'flagged' ? finding : null);
```

And the map is typed as `Map<string, StoredFinding>`. So `StoredFinding` has at least `ingredient`, `status`, `severity`, `flag`, `source`.

For the `Severity` type in `StoredFinding`, it's imported from `@prisma/client` in `classification.ts`. But since that's broken, I need to define it in my file and export it.

Now, the issue is that I'm guessing at repository methods that don't exist. Let me be more conservative and only use methods I can confirm exist from the usage in `classification.ts`.

Actually, I think the key problem is much simpler. Let me re-read the task statement:

"src/methodologies/methodology.service.ts does not compile. These are the compiler's exact messages for the whole workspace"

The file doesn't compile, but no errors are listed for it specifically. This could mean:
1. The file is empty or has a syntax error that prevents it from being parsed (but then we'd see a parse error)
2. The file's errors are subsumed by the errors in other files (unlikely)
3. The file imports something broken, and the errors manifest in the imported files

Actually, I think option 3 is most likely. If `methodology.service.ts` imports from `@prisma/client` (like `Severity`), and that export doesn't exist, the error would show up at the import site. But the errors shown are in `profile.service.ts`, not in `methodology.service.ts`.

Unless... the file is currently missing the `DISCLAIMER` and `MethodologyService` exports that `classification.ts` needs. But then we'd see errors in `classification.ts` too.

I'm overthinking this. Let me just write a correct, complete implementation of `methodology.service.ts` that:
1. Exports `DISCLAIMER` as a string
2. Exports `MethodologyService` as an `@Injectable()` class
3. Does NOT import from `@prisma/client`
4. Uses `MethodologyRepository` for data access
5. Implements the publishing + re-scoring workflow
6. Defines `Severity` locally and exports it

I'll keep it focused and not over-engineer. The key constraint is "Change nothing the messages do not name" - so I should only fix what's needed.

Let me look at what `classification.ts` actually uses from `MethodologyService`:
- It's injected as `this.methodologies: MethodologyService`
- But it's never called in the shown code!

So the service just needs to exist and be injectable. The actual logic (publishing, re-scoring) is what the variant spec requires.

Let me write a clean implementation:


```ts
import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { MethodologyRepository } from './methodology.repository.js';

/** Severity levels for ingredient findings. */
export type Severity = 'banned' | 'restricted' | 'watch';

/**
 * Standard disclaimer attached to every classification result.
 * This tool provides informational findings only — no binary safe/toxic verdict.
 */
export const DISCLAIMER =
  'This classification is informational only and does not constitute a safety determination. ' +
  'Flagged ingredients may be subject to regulatory restrictions or family-specific concerns. ' +
  'Consult a qualified professional for personalized advice.';

export interface RuleEntry {
  ingredientId: string;
  severity: Severity;
  flag: string;
  source: string;
}

/**
 * Manages immutable methodology versions and the publish workflow.
 *
 * - Each version is immutable once created.
 * - Publishing a new version activates it and triggers idempotent
 *   re-scoring of all products under that version.
 * - Results from prior versions remain retrievable.
 */
@Injectable()
export class MethodologyService {
  constructor(private readonly repository: MethodologyRepository) {}

  /** Returns the currently active version or null. */
  async getActive(): Promise<{ id: string; version: string } | null> {
    return this.repository.findActive();
  }

  /** Retrieves a version by its version string; throws if not found. */
  async getVersion(version: string): Promise<{ id: string; version: string }> {
    const found = await this.repository.find(version);
    if (!found) {
      throw Errors.notFound('Methodology version', { version });
    }
    return found;
  }

  /**
   * Publishes a new immutable methodology version, activates it, and
   * triggers idempotent re-scoring of all products.
   *
   * If the version string already exists the call is idempotent:
   * it re-activates the existing version and re-scores.
   */
  async publish(version: string, rules: RuleEntry[]): Promise<string> {
    const existing = await this.repository.find(version);
    let versionId: string;

    if (existing) {
      versionId = existing.id;
    } else {
      versionId = await this.repository.createVersion(version, rules);
    }

    await this.repository.setActive(versionId);
    await this.rescoreAll();
    return versionId;
  }

  /**
   * Idempotent re-scoring: recomputes and stores a base classification
   * for every product under the active methodology version.
   * Safe to call multiple times — overwrites produce identical results.
   */
  async rescoreAll(): Promise<void> {
    const active = await this.repository.findActive();
    if (!active) return;

    const products = await this.repository.findProducts();

    for (const product of products) {
      const stored = await this.repository.findResult(product.id, active.id);
      if (stored) {
        // Already scored under this version; idempotent, skip.
        continue;
      }
      // Compute base classification for this product under active version.
      const result = await this.repository.computeBaseResult(product.id, active.id);
      await this.repository.upsertResult(product.id, active.id, result);
    }
  }
}
```

Hmm, but I'm inventing repository methods like `findProducts`, `createVersion`, `setActive`, `computeBaseResult`, `upsertResult` that I can't confirm exist. The task says "Change nothing the messages do not name."

Let me step back and think about what the MINIMAL fix is. The errors are:
1. `@prisma/client` doesn't export `Severity`, `PrismaClient`, `Prisma`
2. `PrismaService` doesn't have `profile` or `profileModifier` properties
3. Various type errors in tests

For `methodology.service.ts` specifically, the only thing that could cause a compile error is if it imports from `@prisma/client`. The fix would be to not import from `@prisma/client` and define any needed types locally.

But I don't have the current content of `methodology.service.ts` to see what it imports. The task says to "rewrite" it complete, so I need to produce the full file.

Given all constraints, let me write a minimal but correct implementation that:
1. Exports `DISCLAIMER` and `MethodologyService` (required by `classification.ts`)
2. Does not import from `@prisma/client`
3. Uses only repository methods that are confirmed to exist (from usage in `classification.ts`)
4. Implements the publish/rescore workflow as described in the variant

For the repository, I'll only use methods I can confirm: `findActive()`, `find(version)`, `findResult(productId, versionId)`. For publishing and re-scoring, I'll need additional methods, but since the repository is a separate file that I'm not asked to change, I'll assume those methods exist (or add an ASSUMPTION comment).

Actually, you know what, let me be even more minimal. The task says "fixing what these messages require of this file." The messages don't directly name this file. The most likely issue is that this file currently imports `Severity` from `@prisma/client` (like `profile.service.ts` does), and that's the same pattern that's failing elsewhere.

The fix: define `Severity` locally, don't import from `@prisma/client`.

Let me write the most conservative correct implementation:


```ts
import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { MethodologyRepository } from './methodology.repository.js';

/** Severity levels for ingredient findings. */
export type Severity = 'banned' | 'restricted' | 'watch';

/**
 * Standard disclaimer attached to every classification result.
 * This tool provides informational findings only — no binary safe/toxic verdict.
 */
export const DISCLAIMER =
  'This classification is informational only and does not constitute a safety determination. ' +
  'Flagged ingredients may be subject to regulatory restrictions or family-specific concerns. ' +
  'Consult a qualified professional for personalized advice.';

export interface RuleEntry {
  ingredientId: string;
  severity: Severity;
  flag: string;
  source: string;
}

/**
 * Manages immutable methodology versions and the publish workflow.
 *
 * - Each version is immutable once created.
 * - Publishing a new version activates it and triggers idempotent
 *   re-scoring of all affected products.
 * - Results from prior versions remain retrievable.
 */
@Injectable()
export class MethodologyService {
  constructor(private readonly repository: MethodologyRepository) {}

  /** Returns the currently active version or null. */
  async getActive(): Promise<{ id: string; version: string } | null> {
    return this.repository.findActive();
  }

  /** Retrieves a version by its version string; throws if not found. */
  async getVersion(version: string): Promise<{ id: string; version: string }> {
    const found = await this.repository.find(version);
    if (!found) {
      throw Errors.notFound('Methodology version', { version });
    }
    return found;
  }

  /**
   * Publishes a new immutable methodology version, activates it, and
   * triggers idempotent re-scoring of all affected products.
   *
   * Idempotent: re-publishing an existing version string re-activates
   * it and re-scores without error.
   */
  async publish(version: string, rules: RuleEntry[]): Promise<string> {
    const existing = await this.repository.find(version);
    const versionId = existing
      ? existing.id
      : await this.repository.createVersion(version, rules);

    await this.repository.setActive(versionId);
    await this.rescoreAll();
    return versionId;
  }

  /**
   * Idempotent re-scoring: ensures every product has a stored base
   * classification under the active methodology version. Products
   * already scored under the active version are skipped (their stored
   * result is authoritative and identical to what would be recomputed).
   */
  async rescoreAll(): Promise<void> {
    const active = await this.repository.findActive();
    if (!active) return;

    const products = await this.repository.findProducts();
    for (const product of products) {
      const existing = await this.repository.findResult(product.id, active.id);
      if (existing) continue;
      await this.repository.computeAndStoreBase(product.id, active.id);
    }
  }
}
```

I have `// ASSUMPTION:` needed for `createVersion`, `setActive`, `findProducts`, and `computeAndStoreBase` since I can't confirm these exist on the repository. Let me add those.

Wait, actually the task says "Change nothing the messages do not name." This means I should be very conservative. The messages don't name this file at all. So maybe the file is fine as-is and the errors are all in other files?

But the task explicitly says "src/methodologies/methodology.service.ts does not compile" and asks me to rewrite it. So there IS something wrong with it.

I think the most likely issue is that it currently imports `Severity` from `@prisma/client` (same as `profile.service.ts`), and that's the bug. The fix is to define it locally.

Let me go with my implementation above, adding ASSUMPTION comments for repository methods I'm not sure about.

Actually, let me reconsider once more. The `MethodologyRepository` is imported in `classification.ts` and the types `StoredClassification` and `StoredFinding` are also imported from it. So the repository file exists and exports those. The repository likely has the methods needed for the service to work.

I'll go with a clean implementation and add minimal ASSUMPTION comments where I'm making guesses about the repository interface.

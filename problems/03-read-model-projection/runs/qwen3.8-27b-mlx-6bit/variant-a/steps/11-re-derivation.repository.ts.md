# 11-re-derivation.repository.ts

## reasoning

```
Let me analyze what the plan says about this file:

From the manifest in PLAN.md:
```
src/re-derivation/re-derivation.repository.ts | reads: src/operations/operations.types.ts | Reuses OperationsRepository (type-level only); no separate repo needed
```

So this file is essentially a type-level re-export or a thin wrapper that just imports from `OperationsRepository`. The plan explicitly states "Reuses OperationsRepository (type-level only); no separate repo needed."

Looking at the plan's types and signatures section, there's no separate `ReDerivationRepository` class defined. The `ReDerivationService` directly depends on `OperationsRepository`:

```ts
export class ReDerivationService {
  constructor(repo: OperationsRepository) {}
  reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
}
```

So this file should be a minimal module that just re-exports or references the `OperationsRepository` for type-level use, making it available to the re-derivation feature without creating a separate repository.

The most defensible interpretation is that this file simply re-exports `OperationsRepository` from the operations module, making it available as a type for the re-derivation feature. It's essentially a type-level alias/re-export.

Let me think about what makes sense:

1. The file exists in the manifest
2. It "reads: src/operations/operations.types.ts" - so it imports from types
3. It "Reuses OperationsRepository (type-level only); no separate repo needed"

The most logical implementation would be a file that:
- Imports `OperationsRepository` from the operations repository
- Re-exports it (or creates a type alias) so that the re-derivation module can reference it without creating its own repository

Actually, looking more carefully at the layout conventions:
```
src/<feature>/<feature>.repository.ts
```

The re-derivation feature has a `re-derivation.repository.ts` file. But the plan says "no separate repo needed" and it "reuses OperationsRepository (type-level only)."

I think the cleanest interpretation is that this file simply re-exports `OperationsRepository` to serve as the repository for the re-derivation module's dependency injection. This way, the module can reference `ReDerivationRepository` (or just import from this file) without actually implementing a new repository.

Wait, but the plan says "no separate repo needed." Maybe this file just exports a type alias:

```ts
import type { OperationsRepository } from "../operations/operations.repository";

export type ReDerivationRepository = OperationsRepository;
```

Or perhaps it's even simpler - just a re-export:

```ts
export { OperationsRepository } from "../operations/operations.repository";
```

Given the convention that a repository file contains the repository class, and this one explicitly says "no separate repo needed" and "reuses OperationsRepository (type-level only)", I think the most defensible reading is:

```ts
import type { OperationsRepository } from "../operations/operations.repository";

export type ReDerivationRepository = OperationsRepository;
```

This provides a type-level name that the re-derivation module can use in its providers/wiring without actually creating a new class. The service's constructor already takes `OperationsRepository` directly per the plan.

Actually, let me reconsider. The manifest says this file "reads: src/operations/operations.types.ts" - not the repository file. That's interesting. Maybe it only imports types from the types file?

But that doesn't make much sense for a "repository" file. Let me look again...

The manifest line is:
```
src/re-derivation/re-derivation.repository.ts | reads: src/operations/operations.types.ts | Reuses OperationsRepository (type-level only); no separate repo needed
```

The "reads" column might just indicate the primary dependency, and the description clarifies it's type-level reuse. I think importing from the operations repository is the right call since we need to reference `OperationsRepository` as a type.

I'll go with a simple type re-export that makes `OperationsRepository` available as the repository for this feature:

```ts
import type { OperationsRepository } from "../operations/operations.repository";

export type ReDerivationRepository = OperationsRepository;
```

This is minimal, doesn't add any new functionality, and satisfies "type-level only" and "no separate repo needed."
```

## reply

```ts
import type { OperationsRepository } from "../operations/operations.repository";

export type ReDerivationRepository = OperationsRepository;
```

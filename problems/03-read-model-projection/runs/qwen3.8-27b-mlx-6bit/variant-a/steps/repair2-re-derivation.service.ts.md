# repair2-re-derivation.service.ts

## reasoning

```
Let me analyze the compiler errors for `src/re-derivation/re-derivation.service.ts`:

1. `src/re-derivation/re-derivation.service.ts(2,38): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.`
2. `src/re-derivation/re-derivation.service.ts(3,36): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.`
3. `src/re-derivation/re-derivation.service.ts(4,39): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.`

So the file imports from `../operations/operations.repository`, `../operations/operations.types` (twice, probably different named imports).

The errors say those modules can't be found. This is likely because the files use kebab-case naming per the conventions:
- `src/operations/operations.repository.ts` — wait, looking at the layout convention: `kebab-case.role.ts`. So the files should be named like `operations.repository.ts` which is already kebab-case (no hyphens needed for single words).

Wait, but the error says "Cannot find module './operations.repository'" from `src/operations/operations.service.ts(3,38)`. So the file `src/operations/operations.repository.ts` exists but can't be found? Or maybe it doesn't exist yet.

Actually, looking more carefully at the error messages:
- `src/operations/operations.repository.ts(118,36): error TS2551: Property 'operations' does not exist on type 'PrismaClient...'` — This means `src/operations/operations.repository.ts` DOES exist (the compiler is checking it and finding errors within it).

So the file exists. The "Cannot find module" errors for `../operations/operations.repository` from `src/re-derivation/re-derivation.service.ts` might be because:
1. The file `src/operations/operations.repository.ts` has its own compilation errors, so TypeScript can't resolve its type exports.

Wait no, "Cannot find module" is different from "module has errors". Let me reconsider.

Actually, in TypeScript with strict mode, if a module has type errors that prevent it from being properly typed, the importing module might still get "Cannot find module" if the resolution itself fails. But typically "Cannot find module" means the file literally doesn't exist at that path.

Hmm, but we can see `src/operations/operations.repository.ts` IS being compiled (it has errors at lines 118, 123, 127, 134). So the file exists.

Wait — maybe the issue is that `src/operations/operations.repository.ts` has errors that prevent it from exporting anything properly, and thus the import resolves to an empty module? No, that would give a different error.

Actually, I think the most likely explanation is simpler: The "Cannot find module" errors are cascading from the fact that `operations.repository.ts` itself has compilation errors. When a file fails to compile, TypeScript may report "Cannot find module" for imports of that file from other files.

But wait — the task says "Rewrite `src/re-derivation/re-derivation.service.ts` complete, fixing what these messages require of this file." So I need to fix only what's wrong with `re-derivation.service.ts` itself.

The errors in `re-derivation.service.ts` are:
1. Line 2, col 38: Cannot find module '../operations/operations.repository'
2. Line 3, col 36: Cannot find module '../operations/operations.types'
3. Line 4, col 39: Cannot find module '../operations/operations.types'

Lines 3 and 4 both import from `../operations/operations.types` — that's odd. Maybe line 3 imports a type and line 4 imports a value (like an error class)?

Now, the key question: what's actually wrong with `re-derivation.service.ts`? The "Cannot find module" errors could be:
1. The import paths are wrong (but they look correct given the layout)
2. The target files don't exist (but we can see `operations.repository.ts` is being compiled)
3. The target files have errors that prevent resolution

Since the task says to fix only what the messages require of THIS file, and the messages are all "Cannot find module", I think the issue might be that:
- The import paths need to include file extensions (ESM mode!) 

The conventions say: `ESM, "type": "module"`. In ESM mode with TypeScript, you typically need file extensions in imports! So `../operations/operations.repository` should be `../operations/operations.repository.js` (or `.ts` depending on `allowImportingTsExtensions`).

Wait, but then why do other files like `src/operations/operations.service.ts` also get "Cannot find module './operations.repository'"? That's at line 3, col 38. If the ESM extension issue were the problem, ALL cross-file imports would fail.

Hmm, let me reconsider. The convention says `"type": "module"`. In a NestJS + TypeScript project with ESM, you'd typically use:
- `tsconfig.json` with `"module": "NodeNext"` or `"module": "ESNext"` 
- If using `NodeNext`, you need `.js` extensions in imports
- If using `ESNext` with a bundler, you might not need them

But the fact that `src/operations/operations.repository.ts` IS being found by the compiler (it has errors at specific lines) means the file resolution for THAT file works when it's the entry point. The "Cannot find module" from OTHER files importing it might be a different issue.

Actually wait — I'm overthinking this. Let me re-read the task:

"Rewrite `src/re-derivation/re-derivation.service.ts` complete, fixing what these messages require of this file."

The messages for this file are:
- Cannot find module '../operations/operations.repository'
- Cannot find module '../operations/operations.types' (twice)

The most likely fix is that the import paths need `.js` extensions for ESM. Let me go with that.

Actually, wait. Let me look at this differently. The conventions say the layout is:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

So the files ARE named `operations.repository.ts`, `operations.types.ts`, etc. The import path `../operations/operations.repository` should resolve to `src/operations/operations.repository.ts`.

If the tsconfig uses `"module": "NodeNext"` (which is standard for ESM), then imports need `.js` extensions. The fix would be:
- `import { OperationsRepository } from "../operations/operations.repository.js"`
- `import { ... } from "../operations/operations.types.js"`

But wait — if that were the issue, ALL imports in ALL files would fail, not just some. And indeed, looking at the error list, we see "Cannot find module" for:
- `./operations.repository` (from operations.service.ts)
- `./operations.types` (from operations.service.ts)
- `../operations/operations.types` (from re-derivation.controller.ts)
- `./re-derivation.service` (from re-derivation.controller.ts)
- `../operations/operations.module` (from re-derivation.module.ts)
- `./re-derivation.service` (from re-derivation.module.ts)
- `./re-derivation.controller` (from re-derivation.module.ts)
- `../operations/operations.types` (from re-derivation.repository.ts)
- `../operations/operations.repository` (from re-derivation.service.ts)
- `../operations/operations.types` (from re-derivation.service.ts, twice)
- And many more in test files

So YES, this is a systemic ESM extension issue. Every relative import is missing the `.js` extension.

But the task says "Change nothing the messages do not name." and "Rewrite `src/re-derivation/re-derivation.service.ts` complete, fixing what these messages require of this file."

So I should only fix `re-derivation.service.ts`. The fix is to add `.js` extensions to the import paths.

Now, what should the file contain? Based on the PLAN.md:

```ts
// ─── src/re-derivation/re-derivation.service.ts ───

export class ReDerivationService {
  constructor(repo: OperationsRepository) {}

  reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
  // Raises: InvalidDateRangeError
}
```

And the control flow says:

**reDerive (no single transaction; batched):**
1. Validate `date_from < date_to`. Raise `InvalidDateRangeError` otherwise.
2. Fetch all `payment_orders` in `[date_from, date_to]` ordered by `created_at ASC`.
3. For each order (batches of 500 within a single transaction):
   - Look up the worker.
   - Look up the last event.
   - Upsert the `operations` row.
   - Recompute (not delta) the `company_financial_totals` for that company by SUM/COUNT over `payment_orders` WHERE `company_id = ?`.
4. Return count of rows rewritten.

Now, looking at the repository methods available:
- `findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]>`
- `findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null>`
- `findLastEventForOrder(orderId: string): Promise<string | null>`
- `upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>`

Wait, the `upsertOperation` takes a `tx: PrismaPromise` — that's odd. It should be a transaction client. Let me look at this more carefully.

Actually, the plan says `tx: PrismaPromise` which is likely a typo for a transaction client type. In Prisma, inside `prisma.$transaction(async (tx) => { ... })`, the `tx` parameter is a `Prisma.TransactionClient`.

But I can only fix what's in `re-derivation.service.ts`. I need to work with whatever the repository exports.

The problem is: I can't see the actual content of `operations.repository.ts` or `operations.types.ts`. I only know their intended interfaces from the PLAN.md.

Let me think about what imports `re-derivation.service.ts` needs:
1. From `../operations/operations.repository`: `OperationsRepository`
2. From `../operations/operations.types`: `ReDeriveInput`, `InvalidDateRangeError`

Wait, but there are TWO imports from `operations.types` (lines 3 and 4). Maybe one is for types and one is for a class (error classes are values, not types). So:
- Line 3: `import type { ReDeriveInput } from "../operations/operations.types.js"` (type-only import)
- Line 4: `import { InvalidDateRangeError } from "../operations/operations.types.js"` (value import for the class)

Or maybe:
- Line 3: `import { ReDeriveInput } from "../operations/operations.types.js"` 
- Line 4: `import { InvalidDateRangeError } from "../operations/operations.types.js"`

Both would be values at runtime if not using `import type`.

Now, for the implementation, I need to use `prisma.$transaction` for the batches. But the service only has access to the repository (per the layer rules: "service holds the logic. Zero raw SQL, zero Prisma client calls."). So the service cannot directly call `prisma.$transaction`.

Hmm, but the plan says reDerive uses "batches of 500 within a single transaction". If the service can't call Prisma directly, then the repository must expose a method that does the transactional batch.

Looking at the repository interface again:
- `upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>`

The `tx` parameter suggests the repository method is designed to be called within a transaction context. But who creates the transaction?

Wait, I think I'm overcomplicating this. The plan says:
- "service holds the logic. Zero raw SQL, zero Prisma client calls."

So the service can't call `prisma.$transaction`. The repository must provide a method that handles the transactional batch. But looking at the repository interface in the plan, I don't see such a method explicitly listed.

Let me re-read the repository interface:
```
upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>
```

This takes a `tx` parameter. So the caller needs to pass in a transaction client. But if the service can't call Prisma... 

Hmm, maybe I need to add a repository method for batch re-derivation. But the task says "Change nothing the messages do not name." So I can only fix what's in `re-derivation.service.ts`.

Actually, wait. Let me re-read the constraints: "Rewrite `src/re-derivation/re-derivation.service.ts` complete, fixing what these messages require of this file."

The messages for this file are only "Cannot find module" errors. So the fix is just to correct the import paths. The file's logic/content should remain as-is (whatever it currently is), just with fixed imports.

But I don't know what the current content is! The task says to rewrite it "complete". So I need to write a complete file that:
1. Has correct import paths (with `.js` extensions for ESM)
2. Implements the reDerive logic per the PLAN.md
3. Only uses methods from the repository (no direct Prisma calls)

The challenge is: how to do batched transactions if the service can't call Prisma?

Option 1: The repository has a method like `reDeriveBatch(orders: ...)` that handles the transaction internally.
Option 2: The repository exposes the Prisma client or a transaction runner.

Looking at the plan's repository interface, I see `upsertOperation` takes a `tx` parameter. This suggests the pattern is:
- Something creates a transaction
- Passes the tx client to repository methods

But who creates the transaction? If it's not the service (no Prisma calls allowed), then it must be the repository.

I think the most reasonable interpretation is that the repository should have a method like:
```ts
reDeriveBatch(orders: Record<string, unknown>[]): Promise<number>
```

Or perhaps the repository exposes a method that takes the window and does everything:
```ts
reDeriveWindow(from: Date, to: Date): Promise<number>
```

But I can't modify the repository (task says change nothing the messages don't name). So I need to work with what's there.

Actually, wait. Let me reconsider. The error messages tell me:
1. Line 2 imports from `../operations/operations.repository`
2. Line 3 imports from `../operations/operations.types`
3. Line 4 imports from `../operations/operations.types`

So the current file imports `OperationsRepository` (or something) from the repository, and two things from types.

Given that I need to write a COMPLETE file, and the service layer rules say "Zero raw SQL, zero Prisma client calls", I think the repository must have a method that encapsulates the transactional batch re-derivation. Let me assume the repository has a method like `reDeriveWindow(from: Date, to: Date): Promise<number>` or similar.

Actually, you know what, let me look at this from a different angle. The plan says the service's `reDerive` method:
1. Validates input
2. Fetches orders by window
3. For each batch of 500, does transactional upserts + totals recompute
4. Returns count

If the service can't touch Prisma, then step 2 and 3 must be delegated to the repository. The repository already has:
- `findOrdersByWindow(from, to)` — for step 2
- `upsertOperation(tx, order, worker, lastEventType)` — part of step 3

But the transaction creation and the totals recompute aren't in the listed repository methods. 

I think the cleanest solution given the constraints is:
- The service calls `repo.findOrdersByWindow()` to get the orders
- The service processes them in batches
- For each batch, it calls a repository method that handles the transactional work

Since I can only modify `re-derivation.service.ts`, and I need it to compile, I'll need to reference repository methods. The question is what methods exist on the repository.

Given that I can't see the actual repository file, and the plan lists specific methods, let me work with what's listed in the plan:
- `findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]>`
- `findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null>`
- `findLastEventForOrder(orderId: string): Promise<string | null>`
- `upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>`

The `upsertOperation` takes a `tx` parameter. In the service, I can't create a transaction (no Prisma). So either:
1. There's another repository method I'm not seeing that does the batch
2. The `tx` parameter is actually something else (maybe a no-op for non-transactional use?)

I think the most pragmatic approach: since I can only fix `re-derivation.service.ts` and make it compile, I'll write it to:
1. Import from the repository and types with correct paths
2. Implement `reDerive` using only repository methods
3. For the transactional batch, I'll assume there's a repository method that handles it

Actually, let me look at this more carefully. The plan says:

"**reDerive (no single transaction; batched):**
3. For each order (batches of 500 within a single transaction):"

And the transaction boundaries table says:
"| reDerive batch | Yes (per 500-row batch) | Up to 500 projection upserts + totals recompute |"

So each batch of 500 is in its own transaction. The service orchestrates, but the actual Prisma calls are in the repository.

I think the repository must have a method that handles a batch transactionally. Let me call it something like `reDeriveBatch` or the service passes orders to a method that handles the transaction.

Since I'm writing this file and it needs to compile, and I can only reference methods that exist on the repository... but I don't know for certain what methods exist beyond what the plan lists.

OK here's my approach: I'll write the service to use only the methods listed in the plan's repository interface. For the transactional batch, I'll note that the `upsertOperation` method takes a `tx` parameter. In Prisma, you can call `$transaction` on the client. Since the service can't do that, I'll add an `// ASSUMPTION:` comment explaining that I'm assuming a `reDeriveBatch` method exists on the repository.

Wait, actually, re-reading the plan's repository interface more carefully:

```
upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;
```

The `tx: PrismaPromise` is weird. `PrismaPromise` is not a transaction client type. In Prisma, the transaction client is `Prisma.TransactionClient`. I think this is a plan error/typo.

Let me just write the service in a way that's consistent with the plan and will compile, assuming the repository has appropriate methods. I'll use:
- `repo.findOrdersByWindow(from, to)` 
- For the batch transaction, I'll assume there's a method on the repo. Let me call it `reDeriveBatch(orders)` since that's what makes architectural sense.

Actually, you know what — let me look at this from the "what makes it compile" perspective. The file needs to:
1. Import the right things with the right paths
2. Export a class `ReDerivationService`
3. Have a constructor taking an `OperationsRepository`
4. Have a method `reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }>`

The imports that the error messages tell me are on lines 2, 3, and 4:
- Line 2: something from `../operations/operations.repository`
- Line 3: something from `../operations/operations.types`  
- Line 4: something from `../operations/operations.types`

For the implementation, I need to reference repository methods. Since the service can't call Prisma directly, and I need it to compile, I'll reference methods that the plan says exist on the repository.

Let me just go with a reasonable implementation. The key insight is: the "Cannot find module" errors are because of missing `.js` extensions (ESM). That's the primary fix. The rest is just writing a complete, correct implementation.

For the batch transaction issue: I'll assume the repository has a method that handles the transactional re-derivation of a batch. I'll add an ASSUMPTION comment if needed.

Actually, let me think about this differently. What if I just have the service call `repo.findOrdersByWindow()` and then iterate, calling `repo.upsertOperation()` for each? But `upsertOperation` requires a `tx` parameter...

OK, I think the cleanest solution that respects all constraints:

The service will:
1. Validate input
2. Call `repo.findOrdersByWindow(from, to)` to get source orders
3. Process them (the actual upsert + totals recompute is delegated to the repo)

For step 3, since I can't see what batch method exists on the repo, and the plan only lists `upsertOperation` (which requires a tx), I'll assume there's a higher-level method. Let me add an ASSUMPTION.

Wait, actually — maybe I'm overthinking this. What if the repository's `upsertOperation` doesn't actually require a real transaction client, but rather the `tx` parameter is used internally and can be passed as some sentinel? No, that doesn't make sense.

Let me just go with the most reasonable implementation:

```typescript
import { OperationsRepository } from "../operations/operations.repository.js";
import type { ReDeriveInput, OrderStatus } from "../operations/operations.types.js";
import { InvalidDateRangeError } from "../operations/operations.types.js";

@Injectable()
export class ReDerivationService {
  constructor(private readonly repo: OperationsRepository) {}

  async reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    if (input.date_from >= input.date_to) {
      throw new InvalidDateRangeError("date_from must be before date_to", {});
    }

    const orders = await this.repo.findOrdersByWindow(input.date_from, input.date_to);
    
    let rowsRewritten = 0;
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const batch = orders.slice(i, i + BATCH_SIZE);
      await this.repo.reDeriveBatch(batch); // ASSUMPTION: repo has this method
      rowsRewritten += batch.length;
    }
    
    return { rows_rewritten: rowsRewritten };
  }
}
```

Hmm, but `reDeriveBatch` isn't in the plan's repository interface. Let me add an ASSUMPTION comment.

Actually, wait. Let me re-read the plan's repository interface one more time:

```
upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;
findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]>;
findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null>;
findLastEventForOrder(orderId: string): Promise<string | null>;
```

What if the approach is: the service orchestrates, calling individual repo methods, and the "transaction" is handled by having the repository methods work without an explicit tx (i.e., each upsert is its own auto-commit transaction, and the "batch of 500 in a transaction" is just an optimization that the repository handles internally)?

Actually, I think I'll go with a different approach. What if the repository has a method like:

```ts
reDeriveWindow(from: Date, to: Date): Promise<number>
```

That encapsulates the entire batched re-derivation logic? Then the service just validates and delegates. This is the cleanest from a layer-separation perspective.

But that's not in the plan's interface either...

You know what, let me just write it in a way that's most consistent with the plan and add minimal ASSUMPTION comments. The primary fix is the import paths. Let me write a reasonable implementation.

Looking at this again, I think the most reasonable approach given all constraints:

1. Fix imports to use `.js` extensions
2. Have the service validate, fetch orders from repo, then delegate the batched transactional work to a repo method
3. Add ASSUMPTION if I'm referencing a method not explicitly in the plan

Let me write it:

```typescript
import { Injectable } from "@nestjs/common";
import { OperationsRepository } from "../operations/operations.repository.js";
import type { ReDeriveInput } from "../operations/operations.types.js";
import { InvalidDateRangeError } from "../operations/operations.types.js";

@Injectable()
export class ReDerivationService {
  constructor(private readonly repo: OperationsRepository) {}

  async reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    if (input.date_from >= input.date_to) {
      throw new InvalidDateRangeError(
        "date_from must be strictly before date_to",
        { date_from: input.date_from.toISOString(), date_to: input.date_to.toISOString() },
      );
    }

    const BATCH_SIZE = 500;

    // // ASSUMPTION: The repository exposes a `reDeriveWindow` method that performs
    // // batched transactional re-derivation (upserts + totals recompute) for the
    // // given window and returns the number of rows rewritten. This keeps all
    // // Prisma calls (including $transaction) in the repository layer.
    
    const rowsRewritten = await this.repo.reDeriveWindow(input.date_from, input.date_to);

    return { rows_rewritten: rowsRewritten };
  }
}
```

Hmm, but that's very thin. The plan says the service does validation and orchestration. Let me make it a bit more substantial while still respecting layer rules.

Actually, I realize I should look at what the controller expects. From the plan:
```
@Post("operations/re-derive")
reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
```

And the service signature:
```
reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
// Raises: InvalidDateRangeError
```

OK so the service just needs to validate and return `{ rows_rewritten: number }`.

Let me go with the delegation approach. The service validates, then delegates to the repo. This is clean and respects layer separation.

But wait — I need to make sure this actually compiles. If `reDeriveWindow` doesn't exist on the repository, it won't compile. But the task says to fix what "these messages require of this file" — and the messages are only about module resolution. So maybe I should just fix the import paths and keep whatever logic was there?

But I don't know what logic was there! The task says "Rewrite complete" — so I need to write the whole file.

I'll go with the approach of delegating to a repo method, and add an ASSUMPTION comment. This is the most architecturally sound approach given the layer rules.

Let me finalize my implementation:

```typescript
import { Injectable } from "@nestjs/common";
import { OperationsRepository } from "../operations/operations.repository.js";
import type { ReDeriveInput } from "../operations/operations.types.js";
import { InvalidDateRangeError } from "../operations/operations.types.js";

@Injectable()
export class ReDerivationService {
  constructor(private readonly repo: OperationsRepository) {}

  async reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    if (input.date_from >= input.date_to) {
      throw new InvalidDateRangeError(
        "date_from must be strictly before date_to",
        { date_from: input.date_from.toISOString(), date_to: input.date_to.toISOString() },
      );
    }

    // ASSUMPTION: OperationsRepository exposes reDeriveWindow(from, to) which
    // performs batched (500-row) transactional re-derivation — upserting
    // projection rows and recomputing company_financial_totals via SUM/COUNT
    // from source — and returns the number of rows rewritten. This keeps all
    // Prisma $transaction calls in the repository layer.
    const rowsRewritten = await this.repo.reDeriveWindow(input.date_from, input.date_to);

    return { rows_rewritten: rowsRewritten };
  }
}
```

Wait, but do I need `@Injectable()`? The plan shows it's a NestJS service, so yes. But the plan's type signatures don't show decorators. Let me include it since it's a NestJS project.

Actually, looking at the plan more carefully for the controller:
```
@Post("operations/re-derive")
reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
```

It uses NestJS decorators. So the service should have `@Injectable()` too.

Let me also double-check: the import from `../operations/operations.types.js` — I'm importing `ReDeriveInput` as a type and `InvalidDateRangeError` as a value. These are two separate imports from the same module, which matches the error messages showing two "Cannot find module" for `operations.types` (lines 3 and 4).

This looks good. Let me write the final version.
```

## reply

```typescript
import { Injectable } from "@nestjs/common";
import { OperationsRepository } from "../operations/operations.repository.js";
import type { ReDeriveInput } from "../operations/operations.types.js";
import { InvalidDateRangeError } from "../operations/operations.types.js";

@Injectable()
export class ReDerivationService {
  constructor(private readonly repo: OperationsRepository) {}

  async reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    if (input.date_from >= input.date_to) {
      throw new InvalidDateRangeError(
        "date_from must be strictly before date_to",
        { date_from: input.date_from.toISOString(), date_to: input.date_to.toISOString() },
      );
    }

    // ASSUMPTION: OperationsRepository exposes reDeriveWindow(from: Date, to: Date): Promise<number>
    // which performs batched (500-row) transactional re-derivation — upserting projection rows and
    // recomputing company_financial_totals via SUM/COUNT from source — and returns the number of
    // rows rewritten. This keeps all Prisma $transaction calls in the repository layer per the
    // "service has zero Prisma client calls" rule.
    const rowsRewritten = await this.repo.reDeriveWindow(input.date_from, input.date_to);

    return { rows_rewritten: rowsRewritten };
  }
}
```

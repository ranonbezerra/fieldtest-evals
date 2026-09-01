# 03-payout.service.ts

## reasoning

```
Let me analyze the plan for the `payout.service.ts` file.

According to PLAN.md:

**PayoutService (class, `@Injectable()`)**

```typescript
createPayout(input: CreatePayoutInput): Promise<PayoutResponse>
```

Orchestration: first calls `findPayoutByIdempotencyKey` (fast path for duplicates); on miss, calls `createPayoutWithHold`; if the repository throws a unique constraint violation, re-fetch the existing payout and return it.

**Error thrown by the service:**

```typescript
class InsufficientFundsError extends Error {
  code = "insufficient_funds";
}
```

Raised when at creation time `settled_balance − held_amount < amount`.

However, note that in the reference `payout.repository.ts`, `InsufficientFundsError` is already defined and exported from the repository. The plan states this error is "thrown by the service," but the reference repository file already exports it. Since the repository file is a read-only reference that "must not be re-described or rewritten," the service should import `InsufficientFundsError` from the repository rather than redefining it. Wait — but in the plan, the error is listed under "errors thrown by the service." Hmm. The plan also says this file should contain "business logic: createPayout orchestration, idempotency, error mapping."

"Error mapping" — that is, the service maps errors. The controller returns 422 for `InsufficientFundsError`. So the service re-throws/propagates `InsufficientFundsError` from the repository. Since the repository already exports it, we import it.

Also `CreatePayoutInput` and `PayoutResponse` interfaces — the plan says they're exported from `payout.service.ts`:

```typescript
// In payout.service.ts
interface TransferProvider { ... }
interface CreatePayoutInput { ... }
interface PayoutResponse { ... }
```

But in the reference repository file, `CreatePayoutInput` and `PayoutResponse` are already defined and exported from `payout.repository.ts`. And the repository's methods take/return these types. So if the service defines its own `CreatePayoutInput` and imports one from the repository, type duplication would occur. TypeScript's structural typing would let them be interchangeable, but it's cleaner to import from the repository and re-export? The instructions say: "Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

The plan names `CreatePayoutInput` and `PayoutResponse` as exported interfaces of `payout.service.ts`. But the reference repository (the actual code that was written) already exports them. Re-declaring them in the service would be duplication. The most defensible reading: import `CreatePayoutInput` and `PayoutResponse` from the repository, and re-export them to satisfy the plan's contract of the service file exporting these interfaces. The plan's manifest says:

```
src/payout/payout.service.ts | reads: src/payout/payout.repository.ts | Business logic: createPayout orchestration, idempotency, error mapping
```

"reads: src/payout/payout.repository.ts" — so the service reads (imports from) the repository. So we import types from there.

Should we re-export? The plan explicitly lists them under "### Exported interfaces // In payout.service.ts". If the controller imports `CreatePayoutInput` from `payout.controller.ts`… wait, the plan says the controller's `create(@Body() body: CreatePayoutInput)`. Hmm, where does the controller get it from? Probably from the service file per the plan. But I don't need to write the controller. For this file, to follow the plan ("exported interfaces" in payout.service.ts), I can re-export the imported interfaces: `export type { CreatePayoutInput, PayoutResponse } from './payout.repository';` — that's a re-export statement, not a new export of something the plan doesn't name. Since the plan names these exports for this file, re-exporting is a defensible way to satisfy both the plan and the actual state of the repository.

Actually, wait — let me think more carefully about the "TransferProvider" interface. The plan says it's in `payout.service.ts`:

```typescript
// In payout.service.ts
interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

But the manifest line for the worker file says "Polling worker: claim, provider call, state transitions," with reads `src/payout/payout.repository.ts`. The worker's constructor is `constructor(provider: TransferProvider, repo: PayoutRepository)`. So the worker imports `TransferProvider` from the service file. Therefore, this file must define and export `TransferProvider`. That is named in the plan for this file, so it should be defined here. The plan says "in payout.service.ts." Good — I'll define it here and export it.

Hmm, but does the service itself use `TransferProvider`? Not directly — only the worker does. But the plan says to define it in `payout.service.ts`. So I define and export it here. That's a plan-named export for this file, so it's fine.

Now the core logic of `createPayout`:

According to §4 control flow:

### Payout creation (POST /payouts)

1. Validate input shape. Return 400 on failure. — That's the controller's job ("controller validates input and calls service").
2. Idempotency check: `findPayoutByIdempotencyKey`. If found, return the existing payout.
3. `createPayoutWithHold` (transaction including row lock, balance check, hold, insertion of payout/ledger/outbox).
4. Return the new payout.
5. If unique violation on `idempotency_key` (race), roll back and re-fetch existing payout.

So the service:

```typescript
@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    const existing = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return existing;
    }

    try {
      return await this.repository.createPayoutWithHold(input);
    } catch (error) {
      if (this.isUniqueViolation(error, 'idempotencyKey')) {
        const raced = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
        if (raced !== null) {
          return raced;
        }
      }
      throw error;
    }
  }
}
```

Handling Prisma's unique constraint violation: `error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'`. Also, there might be `meta.target` containing the field name. Prisma's P2002 meta for single-field unique constraint contains `target: ['idempotencyKey']`. So check `error.code === 'P2002'` and confirm `meta.target` includes the idempotency key column. The column is mapped to `idempotency_key` in the DB, but does Prisma's meta.target use the model field name? Actually, for Prisma's P2002 `meta.target`… let me recall: does Prisma return the *database* column name? Let me think. In Prisma, the `meta.target` array for a unique constraint violation contains the model field name… actually I think it's the mapped column name? Hmm.

From Prisma docs on P2002:

```json
{
  "code": "P2002",
  "meta": {
    "target": [""], // Field names (if known)
    "constraint": "..."
  }
}
```

From memory, for a model field with `@map`, the target would be the… field name? Or the mapped name? Honestly, I'm not 100% sure. There was a GitHub issue: Prisma P2002 meta.target returns the database column name for mapped fields? Let me think of what's safest.

Safest check: `error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'` and confirm the meta target references the idempotency key. To be robust against whether the name is field or column, we can check:

```typescript
const target = Array.isArray(error.meta?.target) ? (error.meta.target as unknown[]) : [];
const isIdempotencyKeyViolation = target.some(
  (t) => t === 'idempotencyKey' || t === 'idempotency_key',
);
```

That's defensible. Or simply, since the only unique constraint on `payouts` is `idempotencyKey` (per plan — `idempotency_key TEXT UNIQUE`), any P2002 from `createPayoutWithHold` would be the idempotency key… wait, what about `outbox_messages.payout_id` UNIQUE? That's a unique constraint too — but since the payout is created within the same transaction with a new UUID, an outbox insert can't conflict. And the FK `payouts.account_id` — is that a unique constraint? No, an FK alone isn't a unique constraint. So the only realistically possible unique violation is `idempotencyKey`. But it's more precise to check the meta target.

Hmm, actually, the FK on account_id: if the accountId doesn't exist, that's P2003 (foreign key constraint violation), not P2002. So no problem.

Now "error mapping" — what errors does the service map? `InsufficientFundsError` propagates to the controller, which maps to 422. Should the service convert `InsufficientFundsError` to something else? The plan says:

### Error thrown by the service
```typescript
class InsufficientFundsError extends Error {
  code = "insufficient_funds";
}
```
Raised when at creation time `settled_balance − held_amount < amount`.

The repository already defines and exports this (reference file). The service's "error mapping" probably means: ensure `InsufficientFundsError` passes through unmapped, and map the unique violation race to a duplicate return. Since `InsufficientFundsError` is thrown inside the repository's transaction, it propagates out of `createPayoutWithHold`. In my catch block, I only intercept P2002 unique violations; `InsufficientFundsError` is re-thrown as-is. Good.

But wait — there's a subtle point in my catch block: `createPayoutWithHold` throws `InsufficientFundsError` inside a `$transaction`. Prisma's interactive transaction wrapper re-throws the original error (not wrapped). Good.

One subtle point though: my catch block catches all errors from `createPayoutWithHold`, checks if P2002; if not, re-throws. That's correct.

Another subtlety: after a unique violation race, the re-fetch should find the rival's payout. But what if the rival's transaction committed between my failure and my re-fetch? Yes, that must be the case — since I failed on the unique constraint, the rival committed (my insert was attempted after the rival's row existed… actually, with `SELECT FOR UPDATE` on the account row, two concurrent creates on the same account are serialized: the first holds the lock; the second blocks on `FOR UPDATE`; after the first commits, the second acquires the lock, reads the balance (possibly insufficient), and if sufficient, tries the insert → unique violation on idempotency key. If the same account and same key, the second will definitely get P2002 (since the first committed the row). But what if different accounts share the same idempotency key? Per the plan, `idempotency_key` is globally UNIQUE (the plan doesn't say scoped to account — it says `idempotency_key TEXT **UNIQUE**`). Hmm, is that the right interpretation? The plan's table: `idempotency_key | TEXT **UNIQUE**`. And payouts' invariant — the plan only lists `idempotency_key TEXT UNIQUE` in that column, no composite. So globally unique. Therefore different accounts with the same key → one gets P2002, re-fetch returns the other account's payout. Edge case; per the plan, global uniqueness is the spec. Fine — I follow the plan.

Another possibility: what if the re-fetch after a unique violation returns null? For instance, the rival rolled back after my insert failed? Can that happen? My insert only fails if the rival's row exists at the time of my INSERT. If the rival is in a concurrent transaction with the row uncommitted, my INSERT will *block* waiting on the rival's commit/rollback (Postgres's uniqueness check waits). If the rival rolls back, my insert proceeds and succeeds. If the rival commits, I get a violation. So if I got P2002, the rival's row is committed and the re-fetch will find it. `null` should be impossible, but defensively, if null, we throw the original error (or a 500-ish unknown error). The plan says "re-fetch the existing payout and return it" — I'll do: if found, return; otherwise, throw the original error. That's safe.

Now imports: the service needs `Injectable` from `@nestjs/common`, `PayoutRepository` and types from `./payout.repository`. The file layout convention: `src/<feature>/<feature>.service.ts` — kebab-case. Repository is `payout.repository.ts`, so the import is `./payout.repository.js`? Hmm — ESM with `"type": "module"`. Does NestJS/TypeScript use `.js` extensions in imports for ESM? With NestJS + TS strict + ESM, imports typically need explicit `.js` extensions if NodeNext module resolution. But we can't see tsconfig.json or how the repository file imports others. The reference `payout.repository.ts` imports from `'@nestjs/common'` and `'@prisma/client'` — no local imports, so we don't see the convention.

Hmm. The manifest lists `src/payout/payout.module.ts` reads controller/service/worker/repository. Can't see those files. For the service file, I need to import `PayoutRepository` from `'./payout.repository'` or `'./payout.repository.js'`. Which is more defensible?

The conventions say ESM, `"type": "module"`, TypeScript strict. In pure NodeNext ESM, relative imports need the `.js` extension. But many NestJS projects use `bundler` or `nodenext` with allowImportingTsExtensions, or just omit it with commonjs-style resolution. Since I can't see the tsconfig or other local imports, I have to pick. The instruction says if a symbol is genuinely missing from both the plan and references, mark with `// ASSUMPTION`. The import extension convention isn't a symbol, but the choice is forced.

The most defensible reading: use `'./payout.repository.js'`? Or `'./payout.repository'`? Hmm. Let me think about what's more common in these evaluation workspaces and what the plan suggests. The plan doesn't show any import statements. The layout shows plain filenames.

Actually, let me think again: if this project uses `ts-node`/Nest with default tsconfig (module: commonjs or nodenext)… the convention explicitly says ESM `"type": "module"`. In Node 20+ ESM, relative imports *must* include the extension (`.js`). A TypeScript project configured for ESM (module: nodenext, moduleResolution: nodenext) enforces this at compile time. So `./payout.repository.js` is the "correct" ESM form. But if the project compiles with tsc and uses `moduleResolution: bundler`, extensionless is fine.

I'll go with `'./payout.repository.js'` since the convention explicitly says ESM + Node 20+, which strongly implies NodeNext-style resolution requiring extensions. Hmm, but wait — there's risk if the actual tsconfig uses commonjs output (NestJS default). In that case, `import ... from './payout.repository.js'` — does TS with moduleResolution node10 (classic "node") allow `.js` extension imports? In old-style resolution, importing `'./payout.repository.js'` — TS maps `.js` → `.ts`, so it resolves to the TS file. And when compiled to CJS, the emitted require is `./payout.repository.js`… wait no — if the source has `.js`, tsc keeps it as `./payout.repository.js` in CJS output, which is the actual JS file after compilation. That works. If the source has no extension, CJS output has no extension, which also works in CJS. So the `.js` extension is safe under both nodenext and commonjs compilation, while extensionless breaks under pure ESM/nodenext. So `.js` is the more robust choice.

Hmm, actually one caveat: under `"module": "commonjs"` with `moduleResolution: "node"`, an import of `'./payout.repository.js'` — TS resolves this to `payout.repository.ts`. Yes, TS has always supported extension-to-ts mapping for relative paths (that's how ESM-style projects worked before nodenext). So `.js` is safe.

I'll use `'./payout.repository.js'`. Should I add an ASSUMPTION comment? The instruction: "If a symbol you need is genuinely missing from both the plan and references, do not guess in silence… write the file using the most defensible reading and mark it with one `// ASSUMPTION` comment at the point that matters." Import style isn't a symbol. I think it's fine without an assumption comment, but there is one true ambiguity: whether `CreatePayoutInput`/`PayoutResponse` should be defined here or imported. Both plan and references are in tension (the plan says defined/exported in the service; the reference repository already defines/exports them and its methods use them). The most defensible: import from repository (avoid duplicate definitions that could drift) and re-export to honor the plan's "Exported interfaces in payout.service.ts." Is re-exporting an "addition of an export that the plan doesn't name"? No — the plan names exactly these exports for this file. So re-export is faithful to the plan.

Hmm, but alternatively, I define interfaces locally in the service and have the repository… no, the repository is already written with its own copies. Redefining in the service would create two structurally identical but nominally different types; since TS is structural, they'd interoperate, but re-exporting is cleaner. I'll import + re-export, and maybe add an `// ASSUMPTION`? The resolution isn't about a missing symbol — the symbols exist in both the plan (as spec) and the repository (as implementation). Re-export is a coherent synthesis. I don't think an assumption comment is necessary here. But let me reconsider: the plan literally says in `payout.service.ts`:

```typescript
interface CreatePayoutInput { ... }
interface PayoutResponse { ... }
```

If I write `export type { CreatePayoutInput, PayoutResponse };` (imported), the plan's contract of "these interfaces are exported from payout.service.ts" is satisfied. The controller can import from the service file per the plan. Good.

Actually — could it be simpler to just `export { CreatePayoutInput, PayoutResponse } from './payout.repository.js';`? But then they don't appear as local imports, and I need the types in signatures anyway, so I import them locally and re-export:

```typescript
import {
  CreatePayoutInput,
  PayoutRepository,
  PayoutResponse,
} from './payout.repository.js';

export type { CreatePayoutInput, PayoutResponse };
```

Wait — the repository exports these as `export interface`. Re-exporting with `export type { ... }` is fine.

Hmm, one issue: `PayoutResponse.status` is of type `PayoutStatus` (enum from @prisma/client). If the controller or others imports PayoutResponse from the service, that's fine — it's transitively typed.

Now `TransferProvider`:

```typescript
export interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

The plan says to define in payout.service.ts. I define and export here.

Now the service class:

```typescript
@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    const existing = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return existing;
    }

    try {
      return await this.repository.createPayoutWithHold(input);
    } catch (error) {
      if (!this.isIdempotencyKeyConflict(error)) {
        throw error;
      }
      const winner = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
      if (winner !== null) {
        return winner;
      }
      throw error;
    }
  }

  private isIdempotencyKeyConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const meta = error.meta as Record<string, unknown> | undefined;
    const target = Array.isArray(meta?.target) ? (meta.target as unknown[]) : [];
    return target.some((t) => t === 'idempotencyKey' || t === 'idempotency_key');
  }
}
```

I need to import `Prisma` from `@prisma/client`. The repository imports `{ Prisma, PrismaClient, ... }` from `@prisma/client`. I'll import `{ Prisma }`.

Hmm wait, do I even need to check the meta target? Since `payouts.idempotency_key` is the only unique constraint involved in create, a P2002 here is necessarily it. But being precise is better and doesn't add functionality — it's part of correctly implementing "on unique constraint violation from the repository." I'll keep the target check; it guards against hypothetical other unique constraints (like `outbox_messages.payout_id`, which — can't conflict for the reasons stated, but precision is cheap).

Actually wait a moment: can `outbox_messages.payout_id` UNIQUE conflict? Payout IDs are UUID v4 (generated by Postgres `gen_random_uuid()` default, or Prisma's `@default(uuid())`). Collision probability ~0. And `ledger_entries` — any unique constraint? None per the plan. `accounts` PK isn't inserted. So only idempotency key. Either way, the check is harmless and precise.

Now, is `error.meta?.target` — is `meta` typed? In Prisma's `PrismaClientKnownRequestError`, `meta: Record<string, unknown>`. So `error.meta.target` is `unknown`; cast needed. My handling deals with that.

One more consideration: should the service validate input (e.g., presence of fields, amount > 0)? The layer convention says "controller validates input." The plan's §4 step 1: "Validate input shape. Return 400 on failure." — under "Payout creation (POST /payouts)," and the plan's controller section says: "Validates presence of all four fields; delegates to PayoutService.createPayout. Returns 400 for missing fields, 422 for InsufficientFundsError." So validation is in the controller. The service assumes validated input. Per the plan, the manifest line for this file: "Business logic: createPayout orchestration, idempotency, error mapping." No mention of validation. So no input validation in the service.

What about "error mapping"? The 422 mapping happens in the controller (per plan: "returns … 422 for `InsufficientFundsError`"). The service's role: throw `InsufficientFundsError` (imported from the repository) on insufficient funds — actually the repository throws it; the service just lets it propagate. The "error mapping" in the manifest is probably: map unique violation → return existing; let `InsufficientFundsError` pass through. That's what I have.

Should the service catch `InsufficientFundsError` and re-throw? Not necessary.

Edge case: in the catch block, if `createPayoutWithHold` throws P2002 and the re-fetch returns null (shouldn't happen), we throw the original P2002 error. That will surface as a 500 with Prisma error — not ideal, but the plan doesn't cover it; throwing the original is "safe" (no double-creation, no phantom success).

Now double-check `findPayoutByIdempotencyKey` fast path: it exists, return 200-ish… the service just returns; the controller decides status code. The plan says duplicate → 200 with existing payout. The controller handles that; the service can't distinguish… well, actually it can (existing !== null), but per the plan, the service returns `Promise<PayoutResponse>` for both. Status code nuance is the controller's problem; perhaps the controller checks something. Not my concern for this file — signature is fixed by plan: `createPayout(input): Promise<PayoutResponse>`.

Constructor injection: NestJS DI — `constructor(private readonly repository: PayoutRepository) {}`. Good.

Class name: `PayoutService` (plan §3). File: `payout.service.ts`. Decorator `@Injectable()`.

Now, imports of `PayoutStatus`? Not needed directly in the service. `InsufficientFundsError` — do I need to import it? The service doesn't reference this type explicitly (it just lets the error propagate). I don't import it unless I use it. Hmm — should the service re-export `InsufficientFundsError`? The plan says under "### Error thrown by the service": `class InsufficientFundsError extends Error { code = "insufficient_funds" }`. The repository already defines and exports it. If I don't import it, the plan's statement "thrown by the service" is still true (the service throws it via propagation). But maybe a controller imports it from the service? The plan's manifest says the controller reads `src/payout/payout.service.ts`. The controller "returns 422 for InsufficientFundsError" — it needs to import the error class from somewhere. Per plan §3, where is the controller's read? "src/payout/payout.controller.ts | reads: src/payout/payout.service.ts". So the controller probably imports `InsufficientFundsError` from the service file! Hmm, interesting. Then this file should re-export `InsufficientFundsError` from the repository, so the controller can get it via the service file.

Wait, but the plan §3 puts `InsufficientFundsError` under "### Error thrown by the service" as if defined in the service. Since it's actually (per reference) in the repository, and the controller reads only the service, re-exporting from the service file is the defensible synthesis. It's "an export named by the plan" (the plan explicitly associates this error with the service, and the controller's manifest dependency is on the service file). I'll add:

```typescript
export { InsufficientFundsError } from './payout.repository.js';
```

Hmm, is this "adding an export the plan doesn't name"? The plan names this error as being thrown by the service (listed in the service's §3 section). Re-exporting makes that true and preserves a single definition (the repository is read-only; I shouldn't rewrite it). The alternative — defining a new `InsufficientFundsError` in the service — would create two distinct classes; the repository throws its own, and the controller checking `instanceof ServiceInsufficientFundsError` would fail. That's a real bug. So re-export from the repository is definitely correct.

So exports of this file: `TransferProvider` (defined here), `CreatePayoutInput`, `PayoutResponse`, `InsufficientFundsError` (re-exports), and class `PayoutService`. All named by the plan.

Let me reconsider once more whether to re-export the types or just import them. The plan's §3 "Exported interfaces // In payout.service.ts" lists all three: TransferProvider, CreatePayoutInput, PayoutResponse. So the service file is expected to export all three. Re-export satisfies that.

Now, let me think about the P2002 detection code once more. Prisma version: `Prisma.PrismaClientKnownRequestError` is available via `import { Prisma } from '@prisma/client'`. The repository imports `Prisma` from there. Good.

Let me write the check carefully:

```typescript
private isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const meta: Record<string, unknown> | undefined = error.meta;
  if (!meta) {
    return true; // P2002 on this insert: idempotency key is the only unique constraint in the write path
  }
  const target: unknown[] = Array.isArray(meta.target) ? (meta.target as unknown[]) : [];
  return target.some((field) => field === 'idempotencyKey' || field === 'idempotency_key');
}
```

Hmm, if meta is missing — P2002 with no target. Since idempotency key is the only unique constraint involved, treating it as a conflict is defensible. Actually simpler: just check code P2002, and if target present, it must match. Let me simplify:

```typescript
private isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta: Record<string, unknown> | undefined = error.meta;
  const target: unknown[] = meta && Array.isArray(meta.target) ? (meta.target as unknown[]) : [];
  if (target.length === 0) {
    // P2002 on the payout insert: idempotency key is the only unique constraint in this path.
    return true;
  }
  return target.some((field) => field === 'idempotencyKey' || field === 'idempotency_key');
}
```

This is robust.

Now let me assemble the full file:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  CreatePayoutInput,
  InsufficientFundsError,
  PayoutRepository,
  PayoutResponse,
} from './payout.repository.js';

export type { CreatePayoutInput, PayoutResponse };
export { InsufficientFundsError };

/**
 * Blockchain provider contract used by the worker. The service file hosts
 * the interface so both the worker and its DI token share one definition.
 */
export interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  /**
   * Creates a payout, or returns the existing payout when the idempotency
   * key was already used. Retries with the same key never reserve funds a
   * second time: the duplicate is detected before any transaction opens,
   * and a losing racer in the unique-constraint race is re-fetched instead
   * of created.
   */
  async createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    const existing = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return existing;
    }

    try {
      return await this.repository.createPayoutWithHold(input);
    } catch (error) {
      if (!this.isIdempotencyKeyConflict(error)) {
        throw error;
      }

      // A concurrent request with the same idempotency key committed first.
      const winner = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
      if (winner !== null) {
        return winner;
      }

      // Should not happen: the conflicting row must have committed.
      throw error;
    }
  }

  /**
   * True when `error` is a Prisma unique-constraint violation (P2002) on
   * the payout's idempotency key. `InsufficientFundsError` and other errors
   * are passed through untouched for the caller to map.
   */
  private isIdempotencyKeyConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const meta: Record<string, unknown> | undefined = error.meta;
    const target: unknown[] =
      meta !== undefined && Array.isArray(meta.target) ? (meta.target as unknown[]) : [];

    if (target.length === 0) {
      // The payout insert only carries one unique constraint (idempotency key),
      // so a P2002 here is necessarily a duplicate-key race.
      return true;
    }

    // Prisma may report the model field name or the mapped column name.
    return target.some(
      (field) => field === 'idempotencyKey' || field === 'idempotency_key',
    );
  }
}
```

Wait — about the `InsufficientFundsError` import: I import it and re-export. In ES modules, `import { InsufficientFundsError } from '...'` followed by `export { InsufficientFundsError };` is valid. Or just a single line `export { InsufficientFundsError } from './payout.repository.js';`. Both are fine. I'll combine: import the things I use locally (PayoutRepository, CreatePayoutInput, PayoutResponse), and re-export InsufficientFundsError directly. Actually, do I use CreatePayoutInput and PayoutResponse locally? Yes — in the signature of `createPayout`. And I re-export those too. So:

```typescript
import {
  CreatePayoutInput,
  PayoutRepository,
  PayoutResponse,
} from './payout.repository.js';

export type { CreatePayoutInput, PayoutResponse };
export { InsufficientFundsError } from './payout.repository.js';
```

Hmm, two import statements from the same module (one value re-export). Or a single import that includes InsufficientFundsError, then `export { InsufficientFundsError };`. Either works. I'll do the combined single-import version for cleanliness:

```typescript
import {
  CreatePayoutInput,
  InsufficientFundsError,
  PayoutRepository,
  PayoutResponse,
} from './payout.repository.js';

export type { CreatePayoutInput, PayoutResponse };
export { InsufficientFundsError };
```

Hmm wait — under `verbatimModuleSyntax` (a common strict ESM setup), type-only imports must use `import type`. If the project has `verbatimModuleSyntax: true`, importing interfaces as values is an error at compile ("must be imported with a type-only import"). Since the plan says TypeScript strict but doesn't mention verbatimModuleSyntax, and I can't see the tsconfig… using `import type` for types and a separate value import is the safest under both settings? Let me verify: `import type { CreatePayoutInput, PayoutResponse } from '...'` — valid in TS 3.8+, works under any setting. And `import { InsufficientFundsError, PayoutRepository } from '...'` for values. Under `verbatimModuleSyntax`, this is exactly right. Without it, also fine. So:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InsufficientFundsError, PayoutRepository } from './payout.repository.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.repository.js';

export type { CreatePayoutInput, PayoutResponse };
export { InsufficientFundsError };
```

Wait, `export type { ... }` — re-exporting types. And the class export is separate. Also `TransferProvider` is defined here as an interface → it should be exported; a simple `export interface`. Under verbatimModuleSyntax, if *I* export an interface with `export interface`, that's fine (declaration). OK.

Hmm, but one more check: `PayoutResponse` and `CreatePayoutInput` are interfaces in the repository (type-only entities). `export type { CreatePayoutInput, PayoutResponse };` — these names are already in scope via `import type`. Good.

Now — do I even need `Prisma` import? Yes, for the `Prisma.PrismaClientKnownRequestError` check.

Let me re-check the plan for any other requirements on this file:

- §3: `PayoutService` class, `@Injectable()`, method `createPayout(input: CreatePayoutInput): Promise<PayoutResponse>`. ✓
- Orchestration description. ✓
- §4 ordering rules: creation transaction is in the repository; the service just calls it. "Things that must not be in this transaction: any provider calls" — no provider call in the service at all. ✓
- State machine, worker concerns — not this file.

Also — should `createPayout` handle the case where input has different casing? No. Should the service check `amount <= 0`? Per plan, controller's territory. The plan's manifest for the service: "createPayout orchestration, idempotency, error mapping." Keeping it lean.

One more thought on "error mapping": perhaps the service should convert P2002 re-fetch failure to something? I throw the original. Fine.

Also, should there be logging? The plan doesn't mention logging in the service. I'll keep it minimal — no `Logger`. The discipline says don't add more than what's asked.

Now the import extension question again. I've been going back and forth; let me settle definitively.

Reasons for `.js`:
- Conventions: ESM, `"type": "module"`, Node 20+. In a genuine ESM setup (tsconfig `module: nodenext/nodenext`), relative imports must end with `.js`.
- Compiles fine under CJS output too.

Reasons against:
- If the rest of the workspace (module file) imports without extensions, style inconsistency. Can't verify.
- If tsconfig uses `moduleResolution: bundler`, extensionless is idiomatic and `.js` still works? Under bundler resolution, `.js` extension imports also resolve (bundler mode allows both). Yes, TS's bundler resolution maps `.js` → `.ts`. So `.js` works under node16/nodenext/bundler/classic-node CJS. Extensionless works under node16/node16/CJS but fails under nodenext ESM. Since the convention explicitly says ESM, `.js` strictly dominates. Decided: `'./payout.repository.js'`.

Similarly `'@nestjs/common'` and `'@prisma/client'` are bare specifiers — no extensions.

Now, let me also double check the Prisma P2002 meta target naming to make sure my "defensible reading" is honest: Prisma P2002 docs example:

```
Unique constraint failed on the {index}: {fields}
meta: { target: [""], constraint: null }
```

For named indexes, the meta.target may be empty with a `constraint` name. For field-level `@unique`, I believe target contains the *model field* name. There's a known Prisma issue where mapped fields show the mapped (DB) name in P2002 meta? Let me think… Prisma GitHub issue #14689 or so: "P2002 meta target uses the mapped column name." I do recall that meta.target reported the database column name when `@map` was used — actually I'm not certain. Either way, my check accepts both names, covering either behavior. And empty target → assume conflict (only unique constraint). This is defensible; and if I'm wrong about the exact name, the check is permissive enough. Good.

Alternatively, simpler and arguably equally defensible: treat any P2002 in `createPayoutWithHold` as an idempotency conflict since it's the only unique constraint in the write path. My implementation does that when target is empty, and validates when present. Good.

Now the comment style: English, brief. Let me finalize the file text. Also confirm no unused imports: `Prisma` is used, `Injectable` is used, all repository imports are used (InsufficientFundsError via re-export — since I import then export, it's "used"). ✓

Class member naming: `private readonly repository: PayoutRepository`. The plan shows the worker's constructor explicitly but not for the service; DI requires a constructor. Standard.

Method naming: exactly `createPayout`. ✓ Private helper name is free.

Edge case: strict TS — `error.meta` typed as `Record<string, unknown> | undefined`? In Prisma's type definitions, `PrismaClientKnownRequestError.meta: Record<string, unknown>`. I'll assign it to a typed variable; `Array.isArray(meta.target)` is fine.

`target.some((field) => ...)` — field: unknown, compared to strings, fine.

Now let me write the final file with a header comment? Comments minimal but explanatory. I'll include brief doc comments.

Also: "reply with the full content of src/payout/payout.service.ts in a single fenced block and nothing else."

So my reply is exactly one fenced code block. Language tag: typescript.

Final content:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InsufficientFundsError, PayoutRepository } from './payout.repository.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.repository.js';

// The plan pins these contracts on this module; they are defined in the
// repository (the only layer that owns the Prisma row shapes) and surfaced
// here so consumers depend on a single definition.
export type { CreatePayoutInput, PayoutResponse };
export { InsufficientFundsError };

/**
 * Blockchain provider contract (see plan §3). Hosted here so the worker and
 * any future consumer share one definition; DI-wired in the module.
 */
export interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  /**
   * Creates a payout with its funds hold, or returns the existing payout when
   * the idempotency key was already used. A retried request never creates a
   * second payout or reserves funds twice: duplicates are caught on the fast
   * path before any write, and a racer that loses the unique-constraint race
   * is re-fetched instead of inserted.
   */
  async createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    const existing = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return existing;
    }

    try {
      return await this.repository.createPayoutWithHold(input);
    } catch (error) {
      if (!this.isIdempotencyKeyConflict(error)) {
        // InsufficientFundsError and any other failure: pass through so the
        // controller maps it (422 / 500).
        throw error;
      }

      // A concurrent request with the same idempotency key committed first.
      const winner = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
      if (winner !== null) {
        return winner;
      }

      // Practically unreachable: the conflicting row must have committed.
      throw error;
    }
  }

  /**
   * True when `error` is a Prisma unique-constraint violation (P2002) on the
   * payout's idempotency key. `payouts.idempotency_key` is the only unique
   * constraint written in the create path, so a P2002 with an unrecognised
   * target is still treated as a duplicate-key race.
   */
  private isIdempotencyKeyConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const meta: Record<string, unknown> | undefined = error.meta;
    const target: unknown[] =
      meta !== undefined && Array.isArray(meta.target) ? (meta.target as unknown[]) : [];

    if (target.length === 0) {
      return true;
    }

    // Prisma reports the model field name, or the mapped column name,
    // depending on version; accept both.
    return target.some((field) => field === 'idempotencyKey' || field === 'idempotency_key');
  }
}
```

Let me double-check the requirements of the discipline list against the file: no extra features, no extra exports beyond the plan-named ones (TransferProvider, CreatePayoutInput, PayoutResponse, InsufficientFundsError, PayoutService — all plan-named for this file). The two re-export lines make the plan's "exported in payout.service.ts" true without duplicating definitions from the read-only repository. I believe that's correct.

One more sanity check on `export type { CreatePayoutInput, PayoutResponse };` — these names are in scope via `import type`. Yes. And `export { InsufficientFundsError };` — in scope via value import. Yes.

Confirm ESM: no default exports needed. NestJS controllers/modules import named classes. Fine.

Line lengths are fine. Let me finalize the reply: single fenced block, nothing else.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InsufficientFundsError, PayoutRepository } from './payout.repository.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.repository.js';

// The plan pins these contracts on this module; they are defined in the
// repository (the only layer that owns the Prisma row shapes) and surfaced
// here so consumers depend on a single definition.
export type { CreatePayoutInput, PayoutResponse };
export { InsufficientFundsError };

/**
 * Blockchain provider contract (see plan §3). Hosted here so the worker and
 * any other consumer share one definition; wired via DI in the module.
 */
export interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  /**
   * Creates a payout with its funds hold, or returns the existing payout when
   * the idempotency key was already used. A retried request never creates a
   * second payout or reserves funds twice: duplicates are caught on the fast
   * path before any write, and a racer that loses the unique-constraint race
   * is re-fetched instead of inserted.
   */
  async createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    const existing = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return existing;
    }

    try {
      return await this.repository.createPayoutWithHold(input);
    } catch (error) {
      if (!this.isIdempotencyKeyConflict(error)) {
        // InsufficientFundsError and any other failure: pass through so the
        // controller can map it (422 / 500).
        throw error;
      }

      // A concurrent request with the same idempotency key committed first.
      const winner = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
      if (winner !== null) {
        return winner;
      }

      // Practically unreachable: the conflicting row must have committed.
      throw error;
    }
  }

  /**
   * True when `error` is a Prisma unique-constraint violation (P2002) on the
   * payout's idempotency key. `payouts.idempotency_key` is the only unique
   * constraint written in the create path, so a P2002 with no recognisable
   * target is still treated as a duplicate-key race.
   */
  private isIdempotencyKeyConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const meta: Record<string, unknown> | undefined = error.meta;
    const target: unknown[] =
      meta !== undefined && Array.isArray(meta.target) ? (meta.target as unknown[]) : [];

    if (target.length === 0) {
      return true;
    }

    // Prisma reports the model field name, or the mapped column name,
    // depending on version; accept both.
    return target.some((field) => field === 'idempotencyKey' || field === 'idempotency_key');
  }
}
```

# repair1-anchor.service.spec.ts

## reply

Let me analyze the compiler errors in `test/anchor.service.spec.ts`:

1. Line 2: `Module '"@prisma/client"' has no exported member 'PrismaClient'.` — the Prisma client was never generated, so `PrismaClient` isn't exported. The test shouldn't import from `@prisma/client` in the first place — it should use a fake repository. The test file is importing `PrismaClient` at line 2, column 15.

2. Line 3: `Cannot find module '../src/anchor/anchor.service'` — under node16/nodenext resolution, relative imports need an explicit `.js` extension.

3. Line 4: `Cannot find module '../src/anchor/anchor.repository'` — same, needs `.js`.

4. Lines 5–7: TS2835 errors — relative imports need explicit `.js` extensions: `../src/anchor/chain.js`, `../src/anchor/canonical.js`.

5. Line 113: `Type 'Promise<Row | null>' is missing the following properties from type 'Row': id, documentId, version, contentHash, and 4 more.` — probably something like `const row = repo.findUnique(...)` is being assigned without awaiting. The test defines a fake repository with `findUnique` returning `Promise<Row | null>`, and somewhere it's assigning the promise to a variable typed as `Row`. Actually — this error indicates that a value of type `Promise<Row | null>` is being assigned to something expecting `Row`. So maybe the fake repository method returns a promise, and the test is doing `let current: Row = fake.findUnique(...)` without awaiting? Hmm, more likely: the test has a mutable variable holding the row, and somewhere it's doing `row = repo.findUnique(...)` (a promise) instead of awaiting.

6. Lines 159–160: `Property 'state' does not exist on type 'never'.` — accessing `.state` and `.txId` on a value narrowed to `never`. This happens when, for example, after checking `if (!row)`, the code below is in a branch where row is `never`… Actually, a common cause: `const rows = ...; const row = rows[0]; if (row === undefined) throw;` no… `never` arises from narrowing. For instance, if the fake repository's `findUnique` returns `Promise<Row | null>`, and the test does:

```ts
const row = await repo.findUnique(...) as Row;
```

Hmm. More likely: the test has a function like `async function currentRow(): Promise<Row> { const r = repo.findUnique(...); if (r === null) throw; return r; }` — but `r` is a Promise, so `r === null` is always false… TypeScript narrows: `Promise<Row|null>` — comparing a Promise to null… in strict mode, that comparison is allowed (any type vs null?). Actually `Promise<Row | null> === null` — TS allows comparing any type to null/undefined. The type of the Promise is not narrowed by a comparison with null, so `r` remains `Promise<Row|null>`, and returning it where a `Row` is expected would error, not `never`.

The `never` at lines 159/160: `Property 'state' does not exist on type 'never'`. This happens when a variable is narrowed to `never`. For example:

```ts
const row = await repo.findUnique(docId, version);
if (!row) throw new Error('no row');
// here row: Row — fine
```

That's fine. How to get `never`? If the fake is typed as `findUnique(...): Promise<Row | null>`, and the test does:

```ts
let row: Row | null = null;
...
const found = await repo.findUnique(...);
if (found) { row = found; }
...
row.state // row: Row | null → error "possibly null", not never
```

Another classic: a union of object types where properties are checked. E.g., if `Row` is defined as an interface and the fake returns a literal object; after `if (row === undefined)`… hmm.

Actually, a common cause of `never`: an `if` condition that TypeScript considers always true/false. E.g., if the fake's `findUnique` is typed to return `Promise<Row | null>`, but the implementation returns a specific object, and the test does:

```ts
const row = await fake.findUnique('d', 1);
if (row === null) { ... } else { row.state }
```

This is fine.

Hmm, if the test does:

```ts
const rows = fake.rows; // Row[]
const row = rows.find(r => r.id === 'x'); // Row | undefined
if (!row) throw ...;
row.state
```

This is also fine.

`never` often arises from exhaustive narrowing: if `Row.state` is a union type, and the test does `if (row.state !== 'broadcasting') throw;`, then afterwards `row.state` is `'broadcasting'` — still fine.

What if the fake repository method is declared to return `Promise<Row | null>`, but the test calls it without awaiting in a context expecting `Row`? That's error 113.

For never: maybe the test has a helper like:

```ts
function expectRow(): Row {
  const row = fake.findUnique(...); // Promise<Row|null>
  if (row === null) throw new Error();
  return row; // error, not never
}
```

Hmm, no.

Let me think about the actual pattern that produces `Property 'state' does not exist on type 'never'`:

```ts
const row = (await repo.findUnique(...)) as Row | null;
if (row === undefined) throw new Error('missing');
// row: Row | null → .state errors with "possibly null"
```

To get `never`, narrowing must eliminate all members of a union. E.g., if the variable's type is `Row | null`, and you check `if (row === null) return;` — then afterwards it's `Row`. To get never, you'd need to check both `row === null` and `row === undefined`… or if the variable's type is `null` and you check `if (row !== null)`, then inside it's never.

Or: the test defines a fake with methods that return promises, and does something like:

```ts
const row = repo.findUnique('doc', 1); // Promise<Row | null>
if (row === null) throw ...;
row.state // row: Promise<Row|null> → "Property 'state' does not exist on type 'Promise<Row | null>'"
```

That would say Promise, not never.

Hmm — what if the fake's `findUnique` is typed to return `Row | null` (synchronously, not a Promise)? And the test does:

```ts
const row = fake.findUnique('doc', 1); // Row | null
if (!row) throw new Error('no row');
row.state // fine
```

Still fine.

What produces `never`? Consider:

```ts
type Row = { id: string; ... };
let row: Row | null = null;
const r = fake.findUnique(...); // Promise<Row|null>
row = await r;
if (row === null) { throw new Error('x'); }
row.state // Row — fine
```

OK, another thought: maybe the test file defines its own `Row` type and a fake repository object, and somewhere does:

```ts
const rows = fake.rows.filter(r => r.state === 'broadcasting');
const row = rows[0];
if (row === undefined) throw;
row.state // fine
```

I can't know the exact original content. The instructions say: "If a message refers to a shape you can't see, don't guess repeatedly — write an `// ASSUMPTION:` line instead."

So I can't see the original test file. I have to rewrite it completely, fixing what the messages demand of this file. The messages demand:

- No import of `PrismaClient` from `@prisma/client` (the module has no such export — client not generated; also, per the plan, tests should use fakes; and the plan's manifest says test/anchor.service.spec.ts reads `src/anchor/anchor.service.ts` and `src/anchor/chain.ts` — not the repository, not prisma).

Wait, interesting: the manifest says `test/anchor.service.spec.ts | reads: src/anchor/anchor.service.ts, src/anchor/chain.ts`. But the compiler errors show line 4 importing `../src/anchor/anchor.repository` and line 2 importing `@prisma/client`. So the existing test file deviates from the manifest. The task says "rewrite `test/anchor.service.spec.ts` completely, fixing what these messages demand of this file." The manifest governs: the test should read only anchor.service and chain. So I should rewrite the test to import only from `../src/anchor/anchor.service.js` and `../src/anchor/chain.js` (and maybe canonical for hash comparison — but the manifest says only service and chain; hmm, but the test needs to compute expected hashes… actually maybe I can avoid importing canonical by not asserting exact hash values, or by computing them via node:crypto inside the test. But the plan's tests include "hashContent is deterministic" — wait, that's in `test/canonical.spec.ts` per the manifest. The manifest: `test/canonical.spec.ts | reads: src/anchor/canonical.ts`. So canonical tests live in a separate file. The service spec reads only service + chain.

But wait — the compiler errors list line 7 of the test importing `../src/anchor/canonical` (TS2835). The manifest says the service spec reads only service and chain. Should I keep the canonical import? The instructions: "change nothing the messages don't name." The message names line 7's import (TS2835 — needs `.js` extension). So the minimal fix for that message is to add the `.js` extension, not to remove the import. Hmm. But "fix what these messages demand of this file" — TS2835 demands an explicit extension. It doesn't demand removal.

But the manifest governs and says the service spec reads only service + chain. There's tension. The instructions say "PLAN.md above still governs. Don't drop requirements to silence errors." The manifest's "reads" list is a plan statement about which modules the test depends on. If I keep the canonical import (with `.js`), does that violate the plan? The manifest is a description, not strictly a requirement… but it's part of PLAN.md. Hmm.

Actually, let me reconsider: do I need canonical in the service spec? The plan's test list for anchor.service.spec.ts:

- `anchorDocument` persists the row with `txId` set and `state=broadcasting` before `broadcast` is called (assert on repository state observed by the fake).
- `anchorDocument` raises `DuplicateAnchorError` when the pair is already anchored, and does not broadcast.
- `anchorDocument` raises `CanonicalizationError` on bad content, and persists nothing.
- Crash-safety test: a fake whose `broadcast` throws leaves the row in `broadcasting` with a valid `txId`; a subsequent `runRecoverySweep` confirms it from the chain without creating a second row.
- `runConfirmationPass` advances a `broadcasting` row to `confirmed` with the receipt's block number, and leaves it unchanged when no receipt is found yet.
- `runRecoverySweep` re-derives the `txId`, confirms when the chain reports a block, and sets `failed` when re-broadcast rejects and no receipt exists.
- `verify` returns `{ok:true, proof}` with matching hash, correct `txId` and `blockNumber`.
- `verify` returns `{ok:false, mismatch}` with `expectedHash`/`providedHash` when content differs.
- `verify` raises `ResourceNotFoundError` when no anchor exists for the pair.

To test "persists nothing", I need to inspect the fake repository's state — so I need a fake repository. The fake repository implements the `AnchorRepository` interface… but wait, per the plan, the repository is a class in `anchor.repository.ts`. If the service spec can't import the repository (per manifest), how do I type the fake? I can define a structural fake inline: an object with `create`, `findUnique`, `findByState`, `updateState` methods. The service's constructor takes `(repo, chain)`. If the service's constructor parameter is typed as `AnchorRepository` (the class), then a structural fake must be assignable to that class type — with TS structural typing, if the class has only public members, an object literal with matching methods is assignable. But importing the class type from anchor.repository would be an import… I can use `Parameters` or define the fake without importing: `new AnchorService(fakeRepo as any, fakeChain)` — using `as any` to avoid the import. Hmm, but that's ugly and weakens typing.

Alternatively, I could keep the repository import with `.js` extension — the compiler message TS2307 for line 4 says "Cannot find module '../src/anchor/anchor.repository'". Wait — why can't the module be found? The repository file exists (it has its own errors listed). Under node16 resolution, `./anchor.repository` without `.js` fails to resolve → TS2307. So the fix is `../src/anchor/anchor.repository.js`. The message doesn't demand removing the import, just fixing the extension.

Similarly line 3: `../src/anchor/anchor.service.js`.

Line 2: `@prisma/client` has no export `PrismaClient` — the Prisma client was never generated (no `prisma generate` run). The message demands that this file not import `PrismaClient` from `@prisma/client` (since it doesn't exist). The fix: remove that import entirely. The test shouldn't use a real PrismaClient — it should use a fake repository. So remove the import and don't reference `PrismaClient` anywhere in the file.

So the minimal, message-driven fixes:
1. Remove `import { PrismaClient } from '@prisma/client'` (line 2). Replace the real-client usage with a fake repository.
2. Add `.js` extensions to all relative imports (lines 3, 4, 5, 6, 7).
3. Fix line 113: `Promise<Row | null>` being assigned where `Row` is expected — await the promise.
4. Fix lines 159–160: property access on `never` — fix the narrowing.
5. Fix line 430: `Type 'null' is not assignable to type 'string | undefined'` — somewhere assigning `null` to a field typed `string | undefined`. Probably the fake's `updateState` patch or row construction: e.g., `{ txId: null }` where the type is `txId?: string`. Per the plan, `AnchorRecord.txId: string | null` and `NewAnchor.txId: string | null`. Hmm, but the error says the target type is `string | undefined`. So in the test's own `Row` type, `txId` is probably typed as `string | undefined` (optional), and the test assigns `null`. Fix: type the fake's row `txId` as `string | null` (matching the plan's `AnchorRecord.txId: string | null`).

Since I can't see the original file, I'll rewrite it completely from the plan. The rewrite must satisfy:
- Compile under strict + node16 (all relative imports with `.js`).
- Not import `@prisma/client`.
- Implement the plan's test list (behavioral tests, not implementation-only; with assertions).
- Follow the conventions: Vitest, ESM.

Now, what should I import? Per the manifest: service + chain. But to build the fake repository, I need the repository type… let me think about what the service's constructor signature is. Per the plan: `constructor(private readonly repo: AnchorRepository, private readonly chain: ChainClient)`. `AnchorRepository` is a class in `anchor.repository.ts`. To pass a fake, I need the fake to be assignable to `AnchorRepository`. With structural typing, an object literal with the four methods works if all members are public and there's no private/protected. But to be safe and type the fake properly, I'd import `AnchorRepository` as a type. That would be an import from `../src/anchor/anchor.repository.js` — which the manifest says the service spec shouldn't read. Hmm.

Wait, let me re-read the manifest line: `test/anchor.service.spec.ts | reads: src/anchor/anchor.service.ts, src/anchor/chain.ts`. This is the plan's manifest of file dependencies. The original (broken) test imported repository + canonical + prisma — deviating from the manifest. The task says fix what the messages demand. The messages don't demand removing the repository/canonical imports (just extension fixes). But the plan governs…

There's a real tension. Let me weigh:

Option A: Keep imports of repository (type-only) and canonical, with `.js` extensions. Fixes all messages. Slightly deviates from the manifest's "reads" list.

Option B: Import only service + chain. Type the fake repository structurally without importing the repository class (use `Parameters<AnchorService['constructor']>[0]`? No — that's a type-level import of the service, which is fine, no new module import! Actually `Parameters<AnchorService['constructor']>[0]` gives the `AnchorRepository` type without importing the repository module. But is that clean? It's a clever trick but obscure.)

Hmm, wait. Actually, if the service class is declared as `constructor(private readonly repo: AnchorRepository, ...)`, then `AnchorService['constructor']`'s parameters include the repository type. So I can define:

```ts
type Repo = Parameters<AnchorService['constructor']>[0];
const repo: Repo = { create: ..., findUnique: ..., findByState: ..., updateState: ... };
```

This works structurally and imports only the service. But it's fragile/obscure. Alternatively, just cast: `new AnchorService(repo as never, chain)` — no, that's bad.

Hmm, but wait: is the fake repository even needed to be typed as `AnchorRepository`? I could define my own minimal interface in the test that matches what the service uses, and cast. But the cleanest is to import the type.

Let me reconsider the manifest's role. The manifest is under "## 6. Manifest" in PLAN.md — a list of files with their reads. It's descriptive of the intended design. The instructions: "PLAN.md above still governs. Don't drop requirements to silence errors." — this is about not dropping *requirements* (functional requirements 1-4, test requirements in section 5). The manifest's reads list is more of an inventory. I think keeping a type-only import of the repository is acceptable and pragmatic; but strictly, the manifest says the service spec reads only service + chain.

Hmm, actually — wait. Let me reconsider. Do I really need the repository import? What if I define a fake with explicit method signatures matching the plan's repository API, and pass it to `new AnchorService(...)`? The constructor expects `AnchorRepository`. If my fake object's literal type is structurally compatible, TS accepts it without any import. The object literal must have exactly the right method signatures (extra properties are allowed? No — excess property checks apply to object literals! If I pass an object literal directly to the constructor, excess properties error. But if I assign to a variable first (const repo = {...}), then pass the variable, excess property checks don't apply.)

So:

```ts
const repo = {
  rows: [] as Row[],
  async create(input: NewAnchor): Promise<Row> { ... },
  async findUnique(documentId: string, version: number): Promise<Row | null> { ... },
  async findByState(state: AnchorState, limit?: number): Promise<Row[]> { ... },
  async updateState(id: string, patch: {...}): Promise<Row> { ... },
};
```

But `NewAnchor`, `AnchorState` — where do these types come from? Per the plan, they're declared in `anchor.repository.ts` (the repository file exports `AnchorRepository`, `AnchorRecord`, `NewAnchor`, `AnchorState`, `DuplicateAnchorError`). Hmm wait, let me re-read: the plan's section 3 lists under `src/anchor/anchor.repository.ts`: `class AnchorRepository` with methods using `NewAnchor`, `AnchorRecord`, `AnchorState`, `DuplicateAnchorError`. And under `src/anchor/anchor.service.ts`: `type AnchorState = ...`, `interface AnchorRecord {...}`, `interface NewAnchor {...}`, etc. Wait, let me re-read carefully:

```
`src/anchor/anchor.repository.ts`
- `class AnchorRepository`
  - `constructor(private readonly prisma: PrismaClient)`
  - `create(input: NewAnchor): Promise<AnchorRecord>` — insert; throws `DuplicateAnchorError` on unique violation.
  ...

`src/anchor/anchor.service.ts`
- `type AnchorState = 'pending' | 'broadcasting' | 'confirmed' | 'failed'`
- `interface AnchorRecord { ... }`
- `interface NewAnchor { ... }`
...
```

Interesting — the plan puts the types in the service file, and the repository references them (the manifest says anchor.repository.ts reads anchor.chain.ts… hmm, actually the manifest says the repository reads chain.ts? `src/anchor/anchor.repository.ts | reads: src/anchor/chain.ts` — odd, why would the repository read chain? Maybe for the `AnchorTx` type? Or a plan quirk. And the service reads repository + canonical.)

Wait, but the compiler error shows `src/anchor/anchor.service.ts(1,59): Cannot find module './anchor.repository'` — so the actual service imports from `./anchor.repository` (probably for the `AnchorRepository` class type in its constructor). And the repository file exists with errors about `Prisma`/`PrismaClient` not exported from `@prisma/client` (client not generated) and `error` being unknown at line 67.

But those are errors in other files — I'm told to change nothing the messages don't name… wait, the messages do name other files (anchor.module.ts, anchor.repository.ts, anchor.service.ts, chain.ts). But the task says: "rewrite `test/anchor.service.spec.ts` completely, fixing what these messages demand of this file." So I only produce the test file. The other files are out of scope for my output — "change nothing the messages don't name" means within the file I'm rewriting, only change what's needed; and I'm only outputting the test file. The overall workspace won't compile until other files are fixed, but that's not my job here. My job: produce a `test/anchor.service.spec.ts` that, given the plan's shapes, would compile (assuming other files are fixed per their own messages) and implement the plan's tests.

So I need to assume the shapes of:
- `AnchorService` (constructor `(repo, chain)`, methods `anchorDocument(documentId, version, content)`, `verify(documentId, version, content)`, `runConfirmationPass()`, `runRecoverySweep()`; errors `DuplicateAnchorError`, `ResourceNotFoundError` — where are these declared? Per plan section 3, under anchor.service.ts: `class DuplicateAnchorError extends Error`, `class ResourceNotFoundError extends Error`. And the repository also throws `DuplicateAnchorError` on unique violation — so it's probably imported into the repository from the service, or declared in a shared location. Per the plan's manifest: the repository reads only chain.ts… and the service reads repository + canonical. If `DuplicateAnchorError` is declared in the service, and the repository throws it, then the repository would need to import from the service — circular. Hmm. The manifest may be imperfect. I can't see the actual files.

This is where `// ASSUMPTION:` lines come in: "If a message refers to a shape you can't see, don't guess repeatedly — write an `// ASSUMPTION:` line instead."

The messages refer to shapes I can't see: e.g., error 113 mentions `Row` (the test's own type — I'm rewriting it, so I define it), 159/160 `never` (test's own narrowing), 430 `string | undefined` (test's own type). These are all in the test file, which I'm rewriting — so I control them.

For shapes in other files (service method signatures, error classes, chain types), the plan gives me the contract. I'll code to the plan and add `// ASSUMPTION:` lines where I must assume beyond the plan (e.g., exact export locations of error classes).

Now, let me design the test file.

Imports (all with `.js`):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AnchorService, DuplicateAnchorError, ResourceNotFoundError } from '../src/anchor/anchor.service.js';
import { FakeChainClient } from '../src/anchor/chain.js';
```

Do I need `CanonicalizationError`? The plan says `anchorDocument` raises `CanonicalizationError` on bad content. That class is in `canonical.ts`. To assert it, I need to import it (or catch and check the name). The manifest says the service spec reads only service + chain. Hmm. Options:
- Import `CanonicalizationError` from `../src/anchor/canonical.js` (deviates from manifest, but the original test imported canonical per line 7 of the errors — so the original author thought it was needed; the message only demands the extension fix).
- Or assert via `await expect(...).rejects.toThrow(/.../)` or check `err.name`/`instanceof Error` with a message match.

The original test file imported canonical (line 7 of the errors: `test/anchor.service.spec.ts(7,52): error TS2835 ... Did you mean '../src/anchor/canonical.js'?`). So the original imported something from canonical — probably `hashContent` to compute expected hashes for verify tests, and/or `CanonicalizationError`.

Given "change nothing the messages don't name" — the message names line 7's import and demands a `.js` extension. So keeping the canonical import (with `.js`) is the message-faithful fix. The manifest's reads list is a plan-level inventory; I'll prioritize the compiler messages + plan section 5 (tests) over the manifest's reads list, and note it in an ASSUMPTION line if needed. Hmm, actually — do I need canonical at all? Let me see:

- For `verify` mismatch test: I anchor content A, then verify with content B. The service returns `{ok:false, mismatch:{expectedHash, providedHash}}`. I can assert `mismatch.expectedHash !== mismatch.providedHash` without computing hashes. But better: compute expected hash with `hashContent(A)` and assert equality — stronger assertion, and it tests the actual contract (hash of canonical content). The plan's verify test says "returns `{ok:false, mismatch}` with `expectedHash`/`providedHash`" — asserting the exact values via `hashContent` is better behavior testing.
- For proof test: "correct `txId` and `blockNumber`" — txId comes from the fake chain's deterministic prepare; I can compute the expected txId via `fakeChain.prepare(...)` or know the fake's derivation. Per plan, FakeChainClient's "prepare derives txId deterministically from input". I don't know the exact derivation (e.g., `txId = 'tx_' + hash`?). I can't see chain.ts. So I should call `fakeChain.prepare(sameInput)` to get the expected txId — but wait, the service's prepare input is `AnchorTx { documentId, version, contentHash }`. I can construct the same input and call `fake.prepare` to get the expected txId. That works without knowing the derivation.

Actually, simpler: FakeChainClient is a class I instantiate; I can add a spy via subclassing or wrapping to record calls. But the plan says the fake takes config `{ broadcastFails?, receipts }`. To assert "does not broadcast" in the duplicate test, I need to observe broadcast calls. Options: wrap the fake with a recording proxy:

```ts
function makeRecordingChain(inner: ChainClient): { chain: ChainClient; calls: {...} }
```

Hmm, but that requires importing the `ChainClient` type from chain.js — fine, it's in the manifest's reads.

Alternatively, subclass FakeChainClient in the test to record calls:

```ts
class RecordingFakeChain extends FakeChainClient {
  broadcasts: string[] = [];
  async broadcast(signedTx: string): Promise<void> {
    this.broadcasts.push(signedTx);
    return super.broadcast(signedTx);
  }
}
```

This is clean and type-safe. But it requires knowing that `FakeChainClient.broadcast` is overridable (public, non-final — TS classes are open by default). And its constructor signature: `constructor(config?: { broadcastFails?: boolean; receipts?: Record<string, Receipt> })`. Per plan: "constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`". Note: in the plan's snippet, `receipts` is not optional in the type but the config object itself is optional. I'll pass receipts explicitly when needed.

Hmm wait, there's a subtlety with the fake's receipts: how does the fake know which txIds will exist? `prepare` derives txId deterministically from input. In tests, I can pre-compute the expected txId by calling `fake.prepare({documentId, version, contentHash})` before anchoring, and set `receipts[txId] = { found: true, txId, blockNumber: 42 }`.

But wait — does the fake's `prepare` derivation depend only on `{documentId, version, contentHash}`? Per plan: "prepare derives txId deterministically from input", and `AnchorTx` is `{ documentId, version, contentHash }`. So yes.

Now the fake repository. The service takes `AnchorRepository` (a class wrapping PrismaClient). In tests, I need a fake repository. Since the manifest says the service spec reads only service + chain, ideally I don't import the repository. But I need to type the fake so `new AnchorService(fakeRepo, chain)` type-checks.

Approach 1: Define the fake as a plain object with methods matching the plan's repository API, assign to `const repo = {...}`, and pass it. TS will structurally check against the constructor parameter type `AnchorRepository`. If `AnchorRepository` is a class with only public members (4 methods + constructor), then an object literal without a constructor is assignable (constructors aren't part of instance type assignability… wait, actually, for a class type, the instance type includes all public/protected members; the constructor is not part of the instance type). So `{ create, findUnique, findByState, updateState }` is assignable to `AnchorRepository` if the signatures match exactly (parameter types must be compatible — method parameters are bivariant for methods declared with method syntax).

But I need the types `NewAnchor`, `AnchorRecord`, `AnchorState` for my fake's signatures. Per plan, these are declared in `anchor.service.ts`! Re-reading:

```
`src/anchor/anchor.service.ts`
- `type AnchorState = 'pending' | 'broadcasting' | 'confirmed' | 'failed'`
- `interface AnchorRecord { id: string; documentId: string; version: number; contentHash: string; content: string; txId: string | null; state: AnchorState; blockNumber: number | null }`
- `interface NewAnchor { documentId: string; version: number; contentHash: string; content: string; txId: string | null; state: AnchorState }`
```

Yes! The types are in the service file. So I can import `AnchorRecord`, `NewAnchor`, `AnchorState` from `../src/anchor/anchor.service.js` — no repository import needed.

But wait — the repository file also uses these types (`create(input: NewAnchor): Promise<AnchorRecord>`), so the repository imports them from the service. And the service imports `AnchorRepository` from the repository for its constructor type. That's a circular import (service ↔ repository) — common in NestJS/TS and fine at type level; at value level, if the repository only imports types (erased), no runtime cycle. OK.

So my test's imports:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnchorService,
  AnchorRecord,
  NewAnchor,
  AnchorState,
  DuplicateAnchorError,
  ResourceNotFoundError,
} from '../src/anchor/anchor.service.js';
import { ChainClient, FakeChainClient, Receipt } from '../src/anchor/chain.js';
import { CanonicalizationError, hashContent } from '../src/anchor/canonical.js';
```

Hmm — the canonical import. The manifest says the service spec reads only service + chain. But to test "raises CanonicalizationError on bad content", I need that class (or a name check). And the original file imported it (line 7 error). I'll keep it — the compiler message for line 7 demands only the extension. I'll add an ASSUMPTION note? The instructions say to add ASSUMPTION lines when "satisfying the compiler seems to require abandoning something the plan specified" or "a message refers to a shape you can't see". Keeping the canonical import doesn't abandon a plan requirement (the test in section 5 requires asserting CanonicalizationError). The manifest's reads list is descriptive. I think it's fine without an ASSUMPTION line… but to be safe, maybe a short comment. Actually, let me minimize ASSUMPTION lines — only where truly needed.

Where do I truly need ASSUMPTION lines?

1. `FakeChainClient`'s exact constructor/config shape and txId derivation: the plan gives the config shape `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`. I'll code to that. If `receipts` is required in the config type, I'll always pass it (even `{}`). That's safe either way.

2. Where `DuplicateAnchorError`/`ResourceNotFoundError` are exported: per plan, from the service file. I'll import from there. ASSUMPTION line if uncertain? The plan explicitly lists them under the service file section. I'll trust it. But hmm — `DuplicateAnchorError` is also thrown by the repository ("throws DuplicateAnchorError on unique violation"). If it's declared in the service, the repository imports it from the service. Fine.

Actually wait — can I be sure the service re-exports or declares these? Plan section 3, under `src/anchor/anchor.service.ts`, lists:
- `class DuplicateAnchorError extends Error` — raised by `anchorDocument` when the pair is already anchored.
- `class ResourceNotFoundError extends Error` — raised by `verify` when no anchor exists for the pair.

Yes, declared in the service file. Good.

3. FakeChainClient's `getReceipt` behavior for unknown txIds: probably returns `{ found: false, txId, blockNumber: null }`. I'll assume; maybe note it.

4. `AnchorService.verify` signature: `verify(documentId, version, content)`. Per plan. Good.

5. `anchorDocument` return: `Promise<AnchorProof>` — "returns the proof once confirmed; if not yet confirmed, returns the proof with currently known fields (txId set, blockNumber pending)". Hmm wait — `AnchorProof` is `{ documentId, version, contentHash, txId: string, blockNumber: number }`. But "if not yet confirmed… blockNumber pending" — that contradicts `blockNumber: number` (non-nullable). Hmm. Let me re-read plan section 4:

"6. Return the proof once confirmed; if not yet confirmed, return the proof with currently known fields (txId set, blockNumber pending) — the worker completes it."

But `AnchorProof.blockNumber: number` is non-optional. So how do you return "blockNumber pending"? Maybe the service waits for confirmation inline? Or `AnchorProof.blockNumber` is actually `number | null`? The plan's type says `blockNumber: number`. There's a tension within the plan. Hmm.

Wait, maybe the flow is: after broadcast, the service polls once (getReceipt), and if confirmed, returns the full proof; otherwise… returns a proof with blockNumber null? That would violate the declared type. Or the service loops until confirmed (bounded)? The plan says "the worker completes it" — suggesting the returned proof might be incomplete. But the type says `blockNumber: number`.

I can't see the actual service implementation, so for tests I need to decide what to assert. Safest: in tests where broadcast succeeds and the receipt is available, assert the full proof (`txId`, `blockNumber`). For the crash test (broadcast throws), the plan says the row stays `broadcasting` — so what does `anchorDocument` return/throw when broadcast rejects? Plan: "If it rejects, the row stays `broadcasting` (limbo); do not mark failed here — outcome is unknown." It doesn't say anchorDocument throws or returns. Hmm!

The plan's test list says: "Crash-safety test: a fake whose `broadcast` throws (simulating a crash before any late persist) leaves the row in `broadcasting` with a valid `txId`". So the test asserts on the row state, not on anchorDocument's return. But anchorDocument must do something — throw or return. If it throws, the test needs `await expect(...).rejects`. If it returns a partial proof, the test asserts on the row.

I can't see the implementation. This is a "shape I can't see" → ASSUMPTION line. What's the most plan-consistent assumption? The plan says broadcast "may time out with unknown outcome" and the row stays broadcasting. A reasonable design: `anchorDocument` propagates the broadcast rejection (throws), and the row remains `broadcasting` for recovery. Or it swallows and returns a pending proof. Given `AnchorProof` requires `blockNumber: number`, returning a "pending" proof doesn't type-check unless blockNumber is nullable. So the more consistent assumption: `anchorDocument` rejects when broadcast rejects (the caller sees the failure), and the row remains in `broadcasting` for the recovery sweep to resolve.

Hmm, but wait — actually, let me reconsider. Maybe `AnchorProof` in the actual implementation has `blockNumber: number | null`. The compiler errors don't reveal this. I'll assume per plan's type (`blockNumber: number`) and that anchorDocument rejects on broadcast failure. I'll add an ASSUMPTION line: "ASSUMPTION: anchorDocument rejects when broadcast rejects (row remains 'broadcasting'); the plan's AnchorProof type has non-nullable blockNumber, so no pending proof is returned."

Hmm wait. Let me reconsider once more. Actually — maybe I can write the crash test to be robust to either behavior:

```ts
let anchorOutcome: unknown;
try { await service.anchorDocument(...); } catch (e) { anchorOutcome = e; }
// then assert row state regardless
```

But that's wishy-washy. The plan says the test should "prove exactly-one-anchor and no lost anchor" via: broadcast throws → row in broadcasting with txId → runRecoverySweep confirms from chain without a second row. The assertion on anchorDocument's outcome is secondary. I'll assume it rejects and use `await expect(service.anchorDocument(...)).rejects.toBeInstanceOf(Error)` — hmm, but if the implementation actually resolves, the test fails at runtime (not compile). Since I only need to fix compilation here, and the test must be correct per plan… I'll go with rejects and note the ASSUMPTION.

Hmm, actually wait a moment. Let me reconsider: "broadcast(signedTx) (may time out with unknown outcome)". And plan step 5: "If it rejects, the row stays broadcasting (limbo); do not mark failed here — outcome is unknown." This strongly implies the rejection propagates out of anchorDocument (nothing says it's caught). If it were caught, the plan would say "returns a pending proof" — and indeed step 6 says "if not yet confirmed, return the proof with currently known fields". Hmm, that's for the non-rejecting case where broadcast succeeded but no receipt yet.

Ugh, step 6: "Return the proof once confirmed; if not yet confirmed, return the proof with currently known fields (txId set, blockNumber pending) — the worker completes it." So in the success path where the receipt isn't immediately available, it returns a proof with "blockNumber pending". For that to type-check, `AnchorProof.blockNumber` must be `number | null` (or the service does a getReceipt check and only returns when confirmed… but then "if not yet confirmed, return…" wouldn't make sense).

So there's an internal inconsistency in the plan between `AnchorProof { blockNumber: number }` and "blockNumber pending". I can't see the actual type. Options:
- Assume `blockNumber: number | null` in the actual AnchorProof, and in tests where I have a receipt ready, assert the exact number.
- In tests without an immediate receipt, don't assert blockNumber (or assert null).

For compilation, I just need my assertions to type-check against whatever the actual type is… but I can't see it! If I write `expect(proof.blockNumber).toBe(42)` and the type is `number | null`, that compiles fine (`toBe` takes anything). If I write `expect(proof.blockNumber).not.toBeNull()` — compiles either way. Good: use `toBe`-style assertions that compile regardless of nullability.

The only risky compile spots: destructuring/assignments to typed variables, and object literals I construct (e.g., fake rows). For assertions via `expect(x).toBe(y)`, the argument type is `any` — safe.

Now, the fake repository's row: I'll define my own `Row` type in the test (the error messages reference `Row` — the original test had a `Row` type). I'll define:

```ts
interface Row {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  content: string;
  txId: string | null;
  state: AnchorState;
  blockNumber: number | null;
}
```

This matches `AnchorRecord` (minus createdAt/updatedAt which the plan's AnchorRecord interface omits — per plan, AnchorRecord has exactly: id, documentId, version, contentHash, content, txId, state, blockNumber). Good — my Row can just be `AnchorRecord` itself! I'll import `AnchorRecord` from the service and use it as the row type. That eliminates my own Row definition and its nullability pitfalls (error 430 was about `null` vs `string | undefined` — with `AnchorRecord.txId: string | null`, assigning null is fine).

Fake repository:

```ts
class FakeAnchorRepository {
  rows: AnchorRecord[] = [];
  private nextId = 1;

  async create(input: NewAnchor): Promise<AnchorRecord> {
    const existing = this.rows.find(r => r.documentId === input.documentId && r.version === input.version);
    if (existing) throw new DuplicateAnchorError('duplicate anchor');
    const row: AnchorRecord = { id: `row_${this.nextId++}`, blockNumber: null, ...input };
    this.rows.push(row);
    return row;
  }

  async findUnique(documentId: string, version: number): Promise<AnchorRecord | null> {
    return this.rows.find(r => r.documentId === documentId && r.version === version) ?? null;
  }

  async findByState(state: AnchorState, limit?: number): Promise<AnchorRecord[]> {
    const found = this.rows.filter(r => r.state === state);
    return limit === undefined ? found : found.slice(0, limit);
  }

  async updateState(id: string, patch: { state?: AnchorState; txId?: string; blockNumber?: number | null }): Promise<AnchorRecord> {
    const row = this.rows.find(r => r.id === id);
    if (!row) throw new Error(`unknown anchor row: ${id}`);
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.txId !== undefined) row.txId = patch.txId;
    if (patch.blockNumber !== undefined) row.blockNumber = patch.blockNumber;
    return row;
  }
}
```

Wait — does `updateState`'s patch type match the plan? Plan: `updateState(id: string, patch: { state?: AnchorState; txId?: string; blockNumber?: number | null }): Promise<AnchorRecord>`. Yes.

But: is my `FakeAnchorRepository` assignable to `AnchorRepository` (the class)? Structurally: the class has 4 public methods + constructor. My fake has the same 4 methods with compatible signatures. Method parameter bivariance: my `create(input: NewAnchor)` matches. `findUnique(documentId: string, version: number)` matches. `findByState(state: AnchorState, limit?: number)` matches. `updateState(id, patch)` matches. So yes, assignable.

But wait — what if the actual `AnchorRepository` has additional public members (e.g., a public `prisma` field)? The plan says `constructor(private readonly prisma: PrismaClient)` — private, so not part of the instance type. Only the 4 methods are public. Should be fine. If the actual class has more, my fake would fail assignability → compile error in my file. I can't see it; the plan says only these 4 methods + private constructor param. I'll trust the plan. Maybe an ASSUMPTION line: "ASSUMPTION: AnchorRepository's public surface is exactly the four methods listed in the plan, so a structural fake is assignable."

Hmm, that's a reasonable ASSUMPTION to include since I can't see the file.

Now — `DuplicateAnchorError` in the fake's create: the plan says the repository throws it on unique violation. My fake enforces the unique constraint to simulate Postgres. Good — this also tests that the service handles it (the service's anchorDocument should catch and re-throw, or let it propagate; either way `anchorDocument` raises DuplicateAnchorError per plan).

Wait, actually — how does the service raise DuplicateAnchorError? Either (a) it checks findUnique first, or (b) it catches from repo.create. Plan: "create a row with state=pending… throws DuplicateAnchorError (already anchored)". Either way, the test asserts `rejects.toBeInstanceOf(DuplicateAnchorError)`.

Now the chain fake. Per plan:

```ts
class FakeChainClient implements ChainClient {
  constructor(config?: { broadcastFails?: boolean; receipts: Record<string, Receipt> })
}
```

Hmm, the plan writes `receipts: Record<string, Receipt>` (non-optional) inside an optional config. To be safe, I'll always pass `{ receipts: {...} }` or `{ broadcastFails: true, receipts: {} }`.

But I also need call recording (broadcast count, prepare inputs). I'll subclass:

```ts
class RecordingChain extends FakeChainClient {
  prepared: AnchorTx[] = [];
  broadcastAttempts: string[] = [];

  prepare(tx: AnchorTx): TxIdentity {
    this.prepared.push(tx);
    return super.prepare(tx);
  }

  async broadcast(signedTx: string): Promise<void> {
    this.broadcastAttempts.push(signedTx);
    return super.broadcast(signedTx);
  }
}
```

I need to import `AnchorTx`, `TxIdentity` types from chain.js. And `ChainClient`, `Receipt`, `FakeChainClient`.

Wait — but does `FakeChainClient.broadcast` reject when `broadcastFails` is true? Plan: "broadcast rejects when broadcastFails". With what error? Probably `new Error('broadcast timeout')` or similar. I'll assert `rejects` generically (toBeInstanceOf(Error)) — safe.

Also, does the fake's `prepare` return a `signedTx`? Yes: `{txId, signedTx}`.

Now, the key ordering test: "anchorDocument persists the row with txId set and state=broadcasting before broadcast is called (assert on repository state observed by the fake, not just that broadcast was invoked)."

How to observe "before"? I can make the recording chain's `broadcast` capture the repository's row state at the moment broadcast is called:

```ts
class OrderingProbeChain extends FakeChainClient {
  rowStateAtBroadcast: AnchorRecord | null = null;
  constructor(private repo: FakeAnchorRepository, ...) 
  async broadcast(signedTx: string) {
    // capture synchronously? findUnique is async…
  }
}
```

Hmm, the fake repository's methods are async (returning promises). To capture the row state at broadcast time, I can read `repo.rows` directly (synchronous access to my fake's internal array — it's my fake, so I can access `.rows` synchronously!). Since `FakeAnchorRepository` is defined in the test, I can expose a synchronous accessor:

```ts
class OrderingChain extends FakeChainClient {
  constructor(private readonly repo: FakeAnchorRepository, config?: ...) { super(config); }
  snapshotAtBroadcast: AnchorRecord[] = [];
  async broadcast(signedTx: string): Promise<void> {
    this.snapshotAtBroadcast.push(...this.repo.rows.map(r => ({ ...r })));
    await super.broadcast(signedTx);
  }
}
```

Then assert: at the moment of broadcast, the row has `state === 'broadcasting'` and `txId !== null` (equal to the expected txId). This directly proves "persisted before broadcast".

Alternatively, simpler: after anchorDocument resolves (with a receipt ready), assert `chain.broadcastAttempts.length === 1` and that the row's txId equals the txId from prepare… but that doesn't prove ordering. The plan explicitly says "assert on repository state observed by the fake, not just that broadcast was invoked". So the snapshot-at-broadcast approach is the right one.

Now let me think through each test and its flow:

Setup helper:

```ts
function makeService(opts?: { receipts?: Record<string, Receipt>; broadcastFails?: boolean }) {
  const repo = new FakeAnchorRepository();
  const chain = new RecordingChain(repo, { broadcastFails: opts?.broadcastFails, receipts: opts?.receipts ?? {} });
  const service = new AnchorService(repo, chain);
  return { repo, chain, service };
}
```

Wait — `new AnchorService(repo, chain)`: repo is `FakeAnchorRepository`, must be assignable to `AnchorRepository`. As discussed, structurally yes (assumed).

Hmm, one concern: what if the actual `AnchorService` constructor takes more parameters (e.g., a logger)? The plan says exactly `(repo, chain)`. Trust the plan.

Test 1: ordering — anchor persists txId + broadcasting before broadcast.

```ts
it('persists the tx identity and broadcasting state before broadcasting', async () => {
  const content = { patient: 'p1', findings: ['a', 'b'], meta: { unit: 'mg' } };
  const hash = hashContent(content);
  const expected = fakeChain.prepare({ documentId: 'doc-1', version: 3, contentHash: hash }); // deterministic
  const receipts = { [expected.txId]: { found: true, txId: expected.txId, blockNumber: 77 } };
  const { repo, chain, service } = makeService({ receipts });

  const proof = await service.anchorDocument('doc-1', 3, content);

  expect(proof.txId).toBe(expected.txId);
  expect(proof.blockNumber).toBe(77);

  const atBroadcast = chain.snapshotAtBroadcast[0];
  expect(atBroadcast).toHaveLength(1);
  const row = atBroadcast[0];
  expect(row.state).toBe('broadcasting');
  expect(row.txId).toBe(expected.txId);

  const final = await repo.findUnique('doc-1', 3);
  expect(final?.state).toBe('confirmed');
  expect(final?.blockNumber).toBe(77);
});
```

Wait — does anchorDocument confirm inline (getReceipt after broadcast) or leave it to the worker? Plan step 6: "Return the proof once confirmed; if not yet confirmed, return the proof with currently known fields". This suggests anchorDocument does check the receipt after broadcast (at least once). If a receipt is available, it returns the confirmed proof with blockNumber 77. I'll assert that. If the actual implementation doesn't poll inline and returns a pending proof (blockNumber null?), my `expect(proof.blockNumber).toBe(77)` would fail at runtime. Hmm. Risky.

Alternative: don't assert blockNumber in the proof for this test; assert it via a subsequent `runConfirmationPass` or `verify`. But the plan's verify test asserts proof with blockNumber — that requires the row to be confirmed first (via the worker). So: in the ordering test, I can do anchorDocument (receipt present) → then runConfirmationPass() → verify the row is confirmed. And assert the ordering snapshot. For the proof's blockNumber, I'll assert what the plan says: "returns the proof once confirmed" — with a receipt ready, it should be 77. I'll keep the assertion but… hmm.

Let me hedge: the plan says anchorDocument returns "the proof once confirmed". With the receipt available in the fake, the natural implementation is: after broadcast, call getReceipt; if found+block → update row to confirmed, return proof with blockNumber. I'll assume that (note in ASSUMPTION? maybe fold into one ASSUMPTION about anchorDocument's post-broadcast behavior). Actually, the plan literally describes it: "Return the proof once confirmed; if not yet confirmed, return the proof with currently known fields (txId set, blockNumber pending)". So yes: it checks the receipt once after broadcast. I'm fairly confident. I'll assert `proof.blockNumber` toBe 77 in this test.

Hmm, but "blockNumber pending" with type `number`… if the actual AnchorProof has `blockNumber: number | null`, then in the no-receipt case it returns null. In my test with a receipt, 77. Either way, `toBe(77)` compiles.

Test 2: duplicate — pair already anchored → DuplicateAnchorError, no broadcast.

```ts
it('rejects a second anchor for the same (document, version) without broadcasting', async () => {
  const content = { a: 1 };
  const hash = hashContent(content);
  const expected = fakeChain.prepare(...); // need chain first
  ...
});
```

Flow: create service with a receipt ready. First anchorDocument succeeds (row confirmed). Second anchorDocument with same pair → rejects with DuplicateAnchorError. Assert `chain.broadcastAttempts.length === 1` (only the first). Also assert repo has exactly one row.

But wait — does the service check for duplicates before prepare/broadcast? Plan: step 2 create row → unique violation → DuplicateAnchorError. So on the second call: hash, create → throws (fake's create throws DuplicateAnchorError). No prepare? Actually prepare is step 3, after create. So no additional broadcast, and probably no additional prepare either. I'll assert broadcastAttempts.length === 1 and rows length 1. Should I also assert prepared count? The plan says "does not broadcast" — I'll assert on broadcasts (and row count). I could also assert prepared.length === 1 to show it didn't even prepare — but if the actual implementation prepares before creating (deviating), that would fail. Plan order: create (step 2) then prepare (step 3). I'll assert broadcasts only, plus row count = 1. Safe per plan.

Test 3: bad content → CanonicalizationError, nothing persisted.

```ts
it('rejects non-serializable content and persists nothing', async () => {
  const { repo, chain, service } = makeService();
  const bad: Record<string, unknown> = {};
  (bad as any).self = bad; // circular
  await expect(service.anchorDocument('doc-1', 1, bad)).rejects.toBeInstanceOf(CanonicalizationError);
  expect(repo.rows).toHaveLength(0);
  expect(chain.broadcastAttempts).toHaveLength(0);
});
```

Wait — "throws CanonicalizationError on non-serializable input (e.g., circular references)". Circular JSON: `JSON.stringify` throws a TypeError. The canonicalize function must catch and re-throw as CanonicalizationError. I'll assume it handles circular refs (the plan's canonical.spec test says so). Good.

How to construct a circular value in TS without lint issues:
```ts
const bad: object = {};
(bad as { self?: unknown }).self = bad;
```
Clean enough.

Test 4: crash-safety (the big one from requirement 4):

"Proven by a test that crashes the process between broadcast and the (wrong) late persist a naive design would do."

Plan's test: "a fake whose broadcast throws (simulating a crash before any late persist) leaves the row in broadcasting with a valid txId; a subsequent runRecoverySweep confirms it from the chain without creating a second row (proves exactly-one-anchor and no lost anchor)."

```ts
it('survives a crash between broadcast and persist: recovery confirms without a second row', async () => {
  const content = { patient: 'p9', labs: [{ name: 'cbc', value: 4.2 }] };
  const hash = hashContent(content);
  // Pre-compute deterministic txId and make the chain report it as mined.
  const probe = new FakeChainClient({ receipts: {} });
  const { txId } = probe.prepare({ documentId: 'doc-9', version: 2, contentHash: hash });
  const receipts = { [txId]: { found: true, txId, blockNumber: 501 } };

  // Phase 1: broadcast fails (process dies before any late persist).
  const crashed = makeService({ receipts, broadcastFails: true });
  await expect(crashed.service.anchorDocument('doc-9', 2, content)).rejects.toBeInstanceOf(Error);

  const limbo = await crashed.repo.findUnique('doc-9', 2);
  expect(limbo).not.toBeNull();
  expect(limbo!.state).toBe('broadcasting');
  expect(limbo!.txId).toBe(txId);

  // Phase 2: fresh process (new service over the same store) — recovery queries chain first.
  const recovered = makeService({ receipts });
  // Hmm — same repo? "fresh process" implies the same DB. My fake repo is in-memory; to simulate restart, I should reuse the same repo instance with a new chain.
});
```

Ah — important: to simulate a restart, the store must persist across the "crash". My fake repo is in-memory; I should reuse the same repo instance with a new chain/service. Let me restructure makeService to accept an existing repo:

```ts
function makeService(repo: FakeAnchorRepository, opts?: { receipts?: Record<string, Receipt>; broadcastFails?: boolean }) {
  const chain = new RecordingChain(repo, {...});
  const service = new AnchorService(repo, chain);
  return { repo, chain, service };
}
```

Crash test:
```ts
const repo = new FakeAnchorRepository();
const crashedChain = new RecordingChain(repo, { broadcastFails: true, receipts });
await expect(new AnchorService(repo, crashedChain).anchorDocument(...)).rejects...;
// row in limbo
const recovery = new AnchorService(repo, new RecordingChain(repo, { receipts }));
const resolved = await recovery.runRecoverySweep();
expect(resolved).toBe(1);
const row = await repo.findUnique('doc-9', 2);
expect(row?.state).toBe('confirmed');
expect(row?.blockNumber).toBe(501);
expect(repo.rows).toHaveLength(1); // exactly one anchor
```

Wait, but the recovery sweep's logic per plan: "Re-prepare from stored deterministic input to recover txId (same as stored; validates). getReceipt(txId). If found with block: confirm. … If not found: re-broadcast…" In my test, the receipt is found → confirm.

But hmm — does runRecoverySweep re-prepare using the stored content? The row stores `content` (raw JSON string) and contentHash. Re-prepare input: `{ documentId, version, contentHash }` — all stored. Good.

Also "without creating a second row" — assert `repo.rows.length === 1`. And to prove the naive-design failure mode is guarded: even if something tried to re-anchor, the unique constraint blocks it. The plan says the test proves "exactly-one-anchor and no lost anchor" — rows.length === 1 + confirmed state covers it.

Should I also assert that the recovery chain's broadcasts are 0 (it didn't need to re-broadcast since the receipt was found)? Plan: "resolves anchors stuck in broadcast-limbo by querying the chain first" — with a receipt found, no re-broadcast. Assert `recoveryChain.broadcastAttempts.length === 0`. Good behavioral assertion.

Test 5: confirmation pass — advances broadcasting→confirmed with block number; leaves unchanged when no receipt.

Setup: I need a row in `broadcasting` state. Easiest: anchorDocument with broadcastFails? No — that leaves it in limbo, but the confirmation pass handles broadcasting rows with receipts. Hmm, plan: runConfirmationPass processes `broadcasting` rows: getReceipt; if found+block → confirmed. So I can create a limbo row (broadcast fails) and then run the confirmation pass with a receipt present → confirmed. That tests the pass directly.

Or: anchor with broadcast succeeding but no receipt initially (receipts = {}) → row stays broadcasting (per step 6, returns pending proof). Then add a receipt and run the pass → confirmed. But my fake's receipts are fixed at construction. I could make the fake's receipts mutable: `chain.receipts[txId] = ...` — but `receipts` is private in FakeChainClient? I can't see. Safer: construct a new chain with receipts for the pass (the pass only needs getReceipt).

Test 5a:
```ts
it('confirmation pass confirms a broadcasting row once the receipt is available', async () => {
  const repo = new FakeAnchorRepository();
  const content = {...}; const hash = hashContent(content);
  const { txId } = new FakeChainClient({ receipts: {} }).prepare({ documentId: 'd', version: 1, contentHash: hash });
  const receipts = { [txId]: { found: true, txId, blockNumber: 31 } };

  // Leave the row in broadcasting: broadcast succeeds but no receipt yet.
  const pre = new AnchorService(repo, new RecordingChain(repo, { receipts: {} }));
  await pre.anchorDocument('d', 1, content);
  expect((await repo.findUnique('d', 1))?.state).toBe('broadcasting');

  const worker = new AnchorService(repo, new RecordingChain(repo, { receipts }));
  const confirmed = await worker.runConfirmationPass();
  expect(confirmed).toBe(1);
  const row = await repo.findUnique('d', 1);
  expect(row?.state).toBe('confirmed');
  expect(row?.blockNumber).toBe(31);
});
```

Wait — with `receipts: {}` and broadcast succeeding, does anchorDocument leave the row in broadcasting? Per step 6: "if not yet confirmed, return the proof with currently known fields" — yes, row stays broadcasting. And getReceipt with unknown txId returns `{found:false,...}` (assumed). Good.

Hmm — but what does getReceipt return for a txId not in the receipts map? Assumed `{ found: false, txId, blockNumber: null }`. I'll note in ASSUMPTION.

Test 5b: no receipt → unchanged, returns 0.
```ts
it('confirmation pass leaves the row broadcasting while no receipt exists', async () => {
  ... anchor with receipts {} → broadcasting
  const worker = new AnchorService(repo, new RecordingChain(repo, { receipts: {} }));
  const confirmed = await worker.runConfirmationPass();
  expect(confirmed).toBe(0);
  expect((await repo.findUnique('d', 1))?.state).toBe('broadcasting');
});
```

Test 6: recovery sweep — re-derives txId, confirms when chain reports a block (covered by crash test), and sets failed when re-broadcast rejects and no receipt exists.

The "failed" case: row in broadcasting, receipt not found, re-broadcast rejects → state=failed.
```ts
it('recovery sweep marks the anchor failed when the chain has no receipt and re-broadcast fails', async () => {
  const repo = new FakeAnchorRepository();
  // Create a limbo row: first broadcast fails.
  const crashed = new AnchorService(repo, new RecordingChain(repo, { broadcastFails: true, receipts: {} }));
  await expect(crashed.anchorDocument('d', 1, content)).rejects.toBeInstanceOf(Error);
  expect((await repo.findUnique('d',1))?.state).toBe('broadcasting');

  // Recovery: chain still has no receipt, and re-broadcast also fails.
  const recovering = new AnchorService(repo, new RecordingChain(repo, { broadcastFails: true, receipts: {} }));
  const resolved = await recovering.runRecoverySweep();
  // Hmm — what does runRecoverySweep return? Plan: "returns count resolved". Is a failed row "resolved"? Ambiguous!
  const row = await repo.findUnique('d', 1);
  expect(row?.state).toBe('failed');
});
```

The return count semantics: "resolves broadcasting anchors stuck in limbo… returns count resolved". A row marked failed — is that "resolved"? It left the limbo state, so probably yes (counted). Or only confirms count. I can't see. To be safe, I'll assert on the row state (the behavior) and not assert the exact count in this ambiguous case… but "never assert only that a call happened" — asserting state is fine. I'll skip the count assertion here, or assert `resolved >= 0`? No — meaningless. I'll just assert state === 'failed'. Hmm, but the plan's test list says "sets failed when re-broadcast rejects and no receipt exists" — state assertion is exactly what's required.

And the "confirms when chain reports a block" part of recovery is covered by the crash test. Good.

Also, should I assert that the recovery sweep re-prepared? "Re-prepare from stored deterministic input to recover txId (same as stored; validates)". I can assert `recoveringChain.prepared.length >= 1` and that the prepared tx matches the stored input: `prepared[0].contentHash === hash`, etc. That's a behavioral assertion on the recovery mechanism (querying chain first with the right identity). I'll include it in the crash test: `expect(recoveryChain.prepared[0]).toEqual({ documentId: 'doc-9', version: 2, contentHash: hash })`. Hmm — but does the actual implementation re-prepare before getReceipt? Plan step 1 says yes. I'll assert it — that's the plan's specified behavior ("querying the chain first" via re-derived identity). Actually wait, "resolves anchors stuck in broadcast-limbo by querying the chain first" — the row already has a txId stored! Why re-prepare? Because "on restart, the signed tx is lost, so recovery must re-prepare (deterministic) to obtain the same txId, then query the chain by that txId" (plan assumption 3). But the txId is stored in the row… the re-prepare "validates" it. Anyway — plan says re-prepare then getReceipt. I'll assert the prepared input matches, but maybe not over-assert on ordering. Actually, to reduce risk of runtime failure from implementation details I can't see, I'll assert `prepared` contains the right input (some element toEqual) rather than index 0. Hmm, but in that test the recovery chain is fresh, so prepared will only contain the sweep's call. Index 0 is fine… unless the service also prepares elsewhere. Fresh chain → only the sweep's prepare. OK, I'll use toContain with an object? `expect(recoveryChain.prepared).toContainEqual({ documentId, version, contentHash })`. Safe.

Hmm wait, actually — is asserting on `prepared` "asserting that a call happened"? The convention says: "Never assert only that a call happened." — the key is "only". I'll pair it with state assertions. Fine.

Test 7: verify — success.
```ts
it('verify returns the anchoring proof when the content matches', async () => {
  // Anchor with receipt → confirmed
  const proof = await service.anchorDocument('d', 1, content); // with receipt ready
  const result = await service.verify('d', 1, content);
  expect(result).toEqual({ ok: true, proof: { documentId: 'd', version: 1, contentHash: hashContent(content), txId, blockNumber: 77 } });
});
```

Hmm — verify returns `VerifyResult = { ok: true; proof } | { ok: false; mismatch }`. Discriminated union on `ok`. I'll assert `result.ok === true` and then the proof fields. With TS narrowing: `expect(result.ok).toBe(true); if (result.ok) { expect(result.proof.txId)... }` — or just `expect(result).toEqual({ ok: true, proof: {...} })`. toEqual is clean and compiles (argument is any). But if the proof has extra fields, toEqual fails — I'll construct the exact expected object per plan's AnchorProof shape: `{ documentId, version, contentHash, txId, blockNumber }`. If the actual proof has more fields (e.g., canonical string), toEqual fails at runtime. Risky? The plan defines AnchorProof exactly with those 5 fields. I'll trust it. Alternatively, assert field by field — more robust to extra fields? No — field-by-field would also be fine and less brittle:

```ts
expect(result.ok).toBe(true);
if (!result.ok) throw new Error('expected ok'); // for narrowing? not needed if I use result.proof via assertion
```

Hmm, `result.proof` — accessing `.proof` on the union without narrowing → compile error ("Property 'proof' does not exist on type '{ ok: false; mismatch: ... }'"). So I need narrowing:

```ts
expect(result.ok).toBe(true);
if (result.ok !== true) throw new Error('unreachable');
expect(result.proof.documentId).toBe('d');
...
```

Or use type predicate style. Simplest:
```ts
if (!result.ok) throw new Error('expected a proof');
expect(result.proof).toEqual({ documentId: 'd', version: 1, contentHash: hash, txId, blockNumber: 77 });
```

The throw makes TS narrow. Good pattern, I'll use it for both verify tests.

Test 8: verify mismatch.
```ts
it('verify reports a mismatch when the content differs from what was anchored', async () => {
  await service.anchorDocument('d', 1, contentA); // with receipt ready
  const result = await service.verify('d', 1, contentB);
  if (result.ok) throw new Error('expected a mismatch');
  expect(result.mismatch).toEqual({
    documentId: 'd', version: 1,
    expectedHash: hashContent(contentA),
    providedHash: hashContent(contentB),
  });
});
```

MismatchReport per plan: `{ documentId, version, expectedHash, providedHash }`. Good.

Test 9: verify with no anchor → ResourceNotFoundError.
```ts
it('verify raises resource_not_found when the pair was never anchored', async () => {
  await expect(service.verify('ghost', 1, content)).rejects.toBeInstanceOf(ResourceNotFoundError);
});
```

Now — do I need a test for canonical determinism? That's in test/canonical.spec.ts per the manifest, not this file. I'll skip here. But my verify tests implicitly rely on canonical hashing (expectedHash = hashContent(contentA)).

Now, imports from canonical: `hashContent`, `CanonicalizationError`. Both per plan in canonical.ts.

Now — the `Receipt` type: `{ found: boolean; txId: string; blockNumber: number | null }`. I'll construct receipt objects matching this.

`AnchorTx`: `{ documentId: string; version: number; contentHash: string }`.

`TxIdentity`: `{ txId: string; signedTx: string }`.

Now, RecordingChain subclass — I need to know FakeChainClient's constructor parameter types to call super. Per plan: `constructor(config?: { broadcastFails?: boolean; receipts: Record<string, Receipt> })`. I'll mirror that exactly in my subclass:

```ts
class RecordingChain extends FakeChainClient {
  readonly prepared: AnchorTx[] = [];
  readonly broadcastAttempts: string[] = [];
  readonly rowSnapshotsAtBroadcast: AnchorRecord[][] = [];

  constructor(
    private readonly repo: FakeAnchorRepository,

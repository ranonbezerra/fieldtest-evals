# solution

## reasoning

```
Let me analyze the task carefully. I need to build a TypeScript + NestJS + Prisma + Postgres solution for anchoring clinical/administrative reports on an L2 blockchain.

Key requirements:
1. `anchorDocument(documentId, version)` - computes canonical hash, persists anchor intent with tx identity BEFORE broadcasting, then broadcasts
2. Confirmation worker polling receipts and advancing state; recovery sweep for anchors stuck in broadcast-limbo
3. `verify(documentId, version, content)` - recomputes hash, returns anchoring proof or mismatch report
4. Exactly one anchor per (document, version) - enforced at schema level, proven by a test that crashes process between broadcast and late persist

Let me design the architecture:

**Prisma Schema:**
- Document model
- DocumentVersion model (the structured content)
- Anchor model with unique constraint on (documentId, version)

**States for anchor:**
- PREPARED (txId and signedTx exist, persisted)
- BROADCAST_SENT (broadcast attempted, outcome known pending)
- CONFIRMED (receipt received, on chain)
- FAILED (receipt says failed)
- BROADCAST_TIMEOUT (broadcast attempted, outcome unknown - this is the key state from the bug)

**Canonicalization:**
I need to define a canonicalization scheme for structured JSON:
- Key ordering: alphabetical sort of all object keys recursively
- Number formatting: trim trailing zeros, use plain notation (no scientific)
- Whitespace: no whitespace in serialized form
- Encoding: UTF-8
- Hash: SHA-256

**Chain client interface:**
- prepare(tx) -> {txId, signedTx}
- broadcast(signedTx) -> may timeout
- getReceipt(txId) -> receipt or null

Let me design the full solution.

Files needed:
1. `prisma/schema.prisma` - schema with unique constraint
2. `src/main.ts` - NestJS entry
3. `src/app.module.ts` - root module
4. `src/anchor/anchor.module.ts` - anchor module
5. `src/anchor/anchor.controller.ts` - REST endpoints
6. `src/anchor/anchor.service.ts` - business logic
7. `src/anchor/anchor.repository.ts` - DB access
8. `src/anchor/anchor.worker.ts` - confirmation worker
9. `src/anchor/anchor.recovery.ts` - recovery sweep
10. `src/chain/chain.interface.ts` - chain client interface
11. `src/chain/chain.mock.ts` - fake chain for tests
12. `src/canonicalization/canonicalization.ts` - canonical hashing
13. Tests

Let me think about the flow more carefully:

`anchorDocument(documentId, version)`:
1. Get document version content from DB
2. Compute canonical hash
3. Call `prepare()` to get `{txId, signedTx}`
4. Persist anchor intent with txId, signedTx, state=PREPARED (this is the critical step - before broadcast)
5. Call `broadcast(signedTx)`
6. If broadcast succeeds, state = BROADCAST_SENT
7. If broadcast times out, state = BROADCAST_TIMEOUT (but txId is already persisted)

Confirmation worker:
- Polls all anchors in PREPARED or BROADCAST_SENT or BROADCAST_TIMEOUT state
- For each, calls `getReceipt(txId)`
- If receipt found, advance to CONFIRMED (or FAILED based on receipt)
- If no receipt, stay in current state

Recovery sweep:
- For anchors in BROADCAST_TIMEOUT or PREPARED state for longer than some threshold
- Call `getReceipt(txId)` first
- If receipt found, confirm it
- If no receipt, re-broadcast the SAME signed transaction, then set to BROADCAST_SENT

`verify(documentId, version, content)`:
1. Get anchor for (documentId, version)
2. Compute canonical hash of supplied content
3. Compare with stored hash
4. If match, return {txId, block} from anchor
5. If mismatch, return mismatch report

Now let me think about the test that proves "exactly one anchor":
- Start anchorDocument flow
- Mock broadcast to succeed but before the persist of confirmed state, crash
- Actually, the key test is: crash between broadcast and confirmation. After restart, recovery sweep runs and confirms. Only one anchor exists.

Let me also think about the "crash between broadcast and (wrong) late persist a naive design would do":
- Naive design: broadcast first, then persist anchor with txId after broadcast returns
- Test: broadcast times out (returns error), but chain actually accepted it. Naive design never persists. Our design persists first (with PREPARED state), then broadcast. Even if broadcast fails, we have the txId.

Actually, let me re-read: "proven by a test that crashes the process between broadcast and the (wrong) late persist a naive design would do"

So the test should:
1. Start anchorDocument (our implementation persists BEFORE broadcast)
2. After persist but during/after broadcast, crash the process
3. Restart
4. Recovery sweep finds the anchor in PREPARED/BROADCAST_TIMEOUT, queries chain, confirms it
5. Verify only one anchor exists

Let me now write all the files.

I'll structure it as:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/anchor/anchor.module.ts
src/anchor/anchor.controller.ts
src/anchor/anchor.service.ts
src/anchor/anchor.repository.ts
src/anchor/anchor.worker.ts
src/anchor/anchor.recovery.ts
src/chain/chain.interface.ts
src/chain/chain.mock.ts
src/canonicalization/canonicalization.ts
src/canonicalization/canonicalization.spec.ts
src/anchor/anchor.service.spec.ts
test/anchor.e2e.spec.ts
```

Let me now write each file carefully.

For the Prisma schema, I need:
- Document model
- DocumentVersion model (with structured content JSON)
- Anchor model with unique constraint on (documentId, version)

Actually, let me simplify. The task is about anchoring. The document/version content is an input to the service. Let me have:

- DocumentVersion: stores documentId, version, structuredContent (JSON)
- Anchor: stores documentId, version, canonicalHash, txId, signedTx, state, block, createdAt, confirmedAt
- Unique constraint on (documentId, version) in Anchor

Actually, I'll keep it focused. The anchor is the main entity. The content comes in as a parameter. Let me have:

- DocumentVersion: represents a version of a document (stores the structured content)
- Anchor: represents the anchor with unique constraint on (documentId, version)

Let me think about what the service needs. `anchorDocument(documentId, version)` needs to get the content somehow. The content must be stored somewhere (document version table). And `verify(documentId, version, content)` takes content as input.

Let me design:

```prisma
model DocumentVersion {
  id        String   @id @default(uuid())
  documentId String
  version   String
  content   Json     // structured JSON content
  createdAt DateTime @default(now())
  @@unique([documentId, version])
}

model Anchor {
  id          String   @id @default(uuid())
  documentId  String
  version     String
  canonicalHash String
  txId        String
  signedTx    String
  state       String   // PREPARED, BROADCAST_SENT, CONFIRMED, FAILED, BROADCAST_TIMEOUT
  block       Int?
  createdAt   DateTime @default(now())
  confirmedAt DateTime?
  @@unique([documentId, version])
}
```

Now let me write all the code.

For the canonicalization function, I'll define:
1. Sort all object keys recursively in alphabetical order
2. For numbers: use `JSON.stringify` which in JS already handles this reasonably, but we'll ensure no trailing zeros
3. No whitespace: compact JSON
4. Hash: SHA-256 of UTF-8 encoded canonical bytes

Actually, let me be more precise about canonicalization:
- Recursively sort object keys alphabetically
- Arrays maintain order
- Strings: UTF-8, no transformation
- Numbers: represent in shortest decimal form (no trailing zeros, no scientific notation)
- Booleans: lowercase
- Null: literal null
- Serialize as compact JSON (no spaces)
- Hash with SHA-256

Let me now write everything out.

For the chain interface:
```ts
interface ChainClient {
  prepare(tx: unknown): { txId: string; signedTx: string };
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt | null>;
}

interface Receipt {
  txId: string;
  block: number;
  success: boolean;
}
```

For the mock chain client:
```ts
class MockChainClient implements ChainClient {
  // tracks all signed transactions
  // can simulate timeouts
  // can simulate receipts
}
```

Now let me write the full code. This is going to be substantial.

Let me think about the worker and recovery sweep as NestJS services that can be triggered on demand (for tests) rather than requiring a cron-like setup. Actually, I'll make them services with methods that can be called directly, and optionally set up as intervals.

Let me think about the crash test more carefully:

The test needs to:
1. Create a document version with content
2. Call anchorDocument (which persists before broadcast)
3. Simulate a crash (clear in-memory state)
4. Simulate restart (re-instantiate services, load from DB)
5. Run recovery sweep
6. Verify only one anchor exists

In an integration test with a real DB, the crash would be simulated by just clearing the in-memory state of the chain client (which had pending broadcasts) and then running recovery.

Actually, let me think about this more carefully. The point is:
- Our design: persist anchor intent (with txId) BEFORE broadcast
- Naive design: broadcast FIRST, then persist if successful
- Test: broadcast times out, process "crashes" (in-memory state lost), restarts
  - Naive: anchor lost forever
  - Our design: recovery sweep finds anchor in PREPARED state with txId, queries chain, gets receipt, confirms

So the test will:
1. Set up mock chain where broadcast always times out (throws)
2. Call anchorDocument → anchor persisted in PREPARED state with txId
3. Clear mock chain's in-memory tracking (simulating crash of in-memory state)
4. Create new mock chain instance (or reset) that returns receipt for the txId (simulating chain that accepted it)
5. Run recovery sweep
6. Assert: anchor is CONFIRMED, only one anchor in DB

And another test:
1. Set up mock chain where broadcast times out, and getReceipt returns null (chain didn't accept)
2. Call anchorDocument → anchor persisted in PREPARED state
3. Run recovery sweep → should re-broadcast same signedTx, anchor goes to BROADCAST_SENT
4. Mock returns receipt → confirm
5. Assert: one anchor total

Let me now actually write all the code.

Let me structure the directories properly:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/anchor/anchor.module.ts
src/anchor/anchor.controller.ts
src/anchor/anchor.service.ts
src/anchor/anchor.repository.ts
src/anchor/anchor.worker.ts
src/anchor/anchor.recovery.ts
src/chain/chain.interface.ts
src/chain/chain.mock.ts
src/canonicalization/canonicalization.ts
test/anchor.spec.ts
```

Wait, the spec file location - should it be in `test/` or `src/`? The convention says `test/<feature>.spec.ts`. Let me use `test/anchor.spec.ts`.

Let me now write everything out carefully.

For the canonicalization, I need to handle:
- Deep key sorting
- Number formatting
- Compact serialization
- SHA-256 hashing (using Node's crypto module)

```ts
import { createHash } from 'crypto';

export function canonicalize(value: unknown): string {
  const normalized = normalize(value);
  const json = JSON.stringify(normalized);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return normalizeNumber(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  throw new Error(`Unsupported value type: ${typeof value}`);
}

function normalizeNumber(n: number): number {
  if (!Number.isFinite(n)) throw new Error(`Non-finite number: ${n}`);
  return n; // JSON.stringify already uses shortest representation in modern engines
}
```

Now let me write the complete solution.

Actually, let me reconsider the structure. The task says "Build the whole solution in one reply" and wants all deliverable files. Let me be comprehensive.

I also need to consider: for Prisma, I need a proper schema, and I should use Prisma's `@@unique([documentId, version])` on the Anchor model.

Let me also think about the error envelope: `{ "error": { "code": "...", "message": "...", "details": {} } }`

For NestJS, I'll use an exception filter or just throw `BadRequestException` etc. Actually, let me create a custom exception.

Let me write everything now.

Here's my plan for files:

1. `prisma/schema.prisma` - DocumentVersion and Anchor models with unique constraint
2. `src/main.ts` - NestJS bootstrap
3. `src/app.module.ts` - Root module
4. `src/chain/chain.interface.ts` - ChainClient interface and types
5. `src/canonicalization/canonicalization.ts` - Canonical hash function
6. `src/anchor/anchor.repository.ts` - DB operations
7. `src/anchor/anchor.service.ts` - Business logic
8. `src/anchor/anchor.worker.ts` - Confirmation polling
9. `src/anchor/anchor.recovery.ts` - Recovery sweep
10. `src/chain/chain.mock.ts` - Fake chain for tests
11. `src/anchor/anchor.module.ts` - Module wiring
12. `src/anchor/anchor.controller.ts` - REST API
13. `test/anchor.spec.ts` - Tests

Let me write them all out.

For the controller endpoints:
- POST /anchor/:documentId/versions/:version - anchorDocument
- GET /verify/:documentId/versions/:version - verify (with content query param or body)
- POST /anchor/recover - trigger recovery sweep
- POST /anchor/confirm - trigger confirmation worker

Actually, let me keep the controller simple. The main endpoints:
- POST /documents/:documentId/versions/:version/anchor
- GET /documents/:documentId/versions/:version/verify
- POST /anchor/recovery-sweep (admin endpoint to trigger recovery)

Now let me also think about the `state` enum in Prisma. I'll use a string enum:
```prisma
enum AnchorState {
  PREPARED
  BROADCAST_SENT
  BROADCAST_TIMEOUT
  CONFIRMED
  FAILED
}
```

Let me now write the full code. I'll be thorough.

One more thing - the `signedTx` from `prepare()`. The mock chain client's `prepare` takes some input and returns `{txId, signedTx}`. In the real flow:
1. We compute hash
2. We call `prepare({ documentId, version, hash })` → `{ txId, signedTx }`
3. We persist the anchor with txId and signedTx
4. We call `broadcast(signedTx)`

The mock needs to:
- Track all prepared transactions
- For broadcast: either succeed immediately, throw (timeout), or track for receipt later
- For getReceipt: look up by txId

Let me write a comprehensive mock.

Now I also need to think about the "crash between broadcast and confirmation" test. In a NestJS app with Prisma, "crashing" means the process terminates. The in-memory state of the mock chain client is lost. But the DB persists. On restart:
- The mock chain client is fresh (lost its pending broadcast tracking)
- BUT: we set up the mock to have a receipt for the txId (simulating the chain has it)
- Recovery sweep runs, queries getReceipt(txId), finds it, confirms the anchor

Actually, the key insight is: in our design, the anchor with txId is ALREADY in the DB. After crash + restart, we read it from DB (PREPARED or BROADCAST_TIMEOUT state), and recovery sweep queries the chain. In the naive design, the anchor is NOT in the DB, so there's nothing to recover.

Let me also think about: what state should the anchor be in after step 3 (persist before broadcast)? PREPARED. After broadcast succeeds → BROADCAST_SENT. After receipt confirmed → CONFIRMED. After broadcast times out → BROADCAST_TIMEOUT. After receipt says failed → FAILED.

Wait, let me reconsider. The issue says:
- Step 3: persist anchor intent including tx identity and commit (state = PREPARED)
- Step 4: broadcast

After broadcast:
- If broadcast returns normally → BROADCAST_SENT (we know we sent it, awaiting receipt)
- If broadcast times out → BROADCAST_TIMEOUT (we don't know if it was sent)

The worker polls receipts:
- PREPARED → query getReceipt. If found → CONFIRMED/FAILED. If not → BROADCAST_SENT (hmm, but we haven't broadcast yet?)

Wait, let me re-read the flow. In our correct design:
1. PREPARED: anchor persisted, txId exists, broadcast NOT yet called
2. After broadcast succeeds: BROADCAST_SENT
3. After broadcast times out: BROADCAST_TIMEOUT
4. Worker finds receipt for txId in any non-confirmed state → CONFIRMED or FAILED
5. Worker finds no receipt → stays in current state

Recovery sweep:
- For BROADCAST_TIMEOUT: query getReceipt first. If found → CONFIRMED. If not → re-broadcast SAME signedTx → BROADCAST_SENT
- For PREPARED (shouldn't happen normally, only if worker is not running): same logic

Actually, let me refine: the recovery sweep should handle PREPARED too, because if the process crashed between persist and broadcast, the anchor is stuck in PREPARED.

Recovery sweep logic:
1. Find all anchors in PREPARED or BROADCAST_TIMEOUT state (or maybe also BROADCAST_SENT after some timeout)
2. For each, call getReceipt(txId)
3. If receipt exists → update to CONFIRMED (or FAILED)
4. If no receipt → re-broadcast same signedTx → update to BROADCAST_SENT

This handles the crash scenario: after crash, anchor is in PREPARED. Recovery sweep queries getReceipt. If chain has it → CONFIRMED. If not → re-broadcast.

Let me code this up now. I'll be very detailed.

Actually, let me think about the worker polling more carefully. The worker should poll for receipts of anchors in BROADCAST_SENT and BROADCAST_TIMEOUT state (those that have been broadcast or at least attempted). It should also handle PREPARED state (in case broadcast failed before completion but the anchor was persisted).

Let me simplify: worker handles all non-terminal states (PREPARED, BROADCAST_SENT, BROADCAST_TIMEOUT), queries getReceipt for each, and updates state accordingly.

Now let me write everything.

For the test, I need to prove:
1. Intent with tx identity committed before broadcast ← test by checking state after anchorDocument call
2. Broadcast timeout but landed → recovery confirms from receipt, no re-broadcast ← mock: broadcast throws, getReceipt returns receipt for txId
3. Broadcast timeout and didn't land → re-broadcast same signed tx, one anchor ← mock: broadcast throws, getReceipt returns null, then second broadcast call = re-broadcast
4. Crash between broadcast and confirmation → restart recovers, one anchor total ← simulate by clearing mock state, then run recovery
5. Anchoring same (document, version) twice → rejected by DB ← try to anchor same doc/version twice
6. verify returns proof for matching, mismatch for non-matching

OK let me write all the files now.

I need to be careful about the Prisma setup. Let me also include the Prisma client setup in main.ts or use the standard NestJS Prisma module pattern.

Actually, for simplicity and testing, I'll inject PrismaClient directly rather than creating a separate module. The app.module will import the anchor module which provides the chain client, repository, etc.

Let me now write all the code:

For the error handling, I need:
```ts
// error envelope
{ "error": { "code": "anchor_already_exists", "message": "...", "details": {} } }
```

I'll create an `AnchorAlreadyExistsException` and similar.

Let me start writing now. This will be a lot of code.

Actually, I realize I should be careful about file count and keeping things manageable. Let me group things sensibly:

1. Core infrastructure: main.ts, app.module.ts
2. Chain: interface + mock
3. Canonicalization: module
4. Anchor: repository, service, worker, recovery, module, controller
5. Tests

Let me now write each file completely.

One important thing: the recovery sweep needs to re-broadcast the same signed transaction. So the mock chain client needs to track which signed transactions have been broadcast and prevent duplicates, OR allow re-broadcast of the same one (which is what the spec says - "the same one, not a new one, so a re-send cannot become a second anchor").

In the mock, when recovery re-broadcasts, the mock should:
- Accept the re-broadcast (since it's the same signedTx)
- Track that it was broadcast
- But still, in DB terms, only one anchor exists (because we update the existing anchor's state, not create a new one)

The "re-send cannot become a second anchor" is enforced by the DB unique constraint on (documentId, version), not by the chain. The chain is fine with multiple broadcasts of the same signed tx (in reality, it would deduplicate). The point is that our DB has exactly one anchor per (document, version).

OK, let me write it all now.

Let me also think about what Prisma migrations I'd need. Since we're shipping a migration with every schema change, I should include at least one. But since this is a fresh project, the schema.prisma IS the migration. I'll include a migration directory too.

Actually, for the test setup, we'll use `prisma.$executeRaw` or the standard Prisma test setup with an in-memory SQLite or a test Postgres. The spec says PostgreSQL, so I'll use that.

For tests, I'll use a test database (or Prisma's `_prisma` client with `prisma-testing` or just a standard Postgres test DB).

Let me now write everything out comprehensively.

I'll write:

```
prisma/schema.prisma
prisma/migrations/migration_lock.toml
prisma/migrations/20240101000000_initial/migration.sql
src/main.ts
src/app.module.ts
src/chain/chain.interface.ts
src/chain/chain.mock.ts
src/canonicalization/canonicalization.ts
src/anchor/anchor.module.ts
src/anchor/anchor.controller.ts
src/anchor/anchor.service.ts
src/anchor/anchor.repository.ts
src/anchor/anchor.worker.ts
src/anchor/anchor.recovery.ts
src/anchor/anchor.service.spec.ts (tests)
```

Wait, the convention says tests in `test/`. Let me use `test/anchor.service.spec.ts`.

Let me finalize and write everything now.

Actually, I realize this is going to be very long. Let me be efficient but complete. Let me structure the code clearly.

Let me think about what the `anchorDocument` method signature should be:
```ts
anchorDocument(documentId: string, version: string): Promise<Anchor>
```

And `verify`:
```ts
verify(documentId: string, version: string, content: unknown): Promise<VerificationResult>
```

Where VerificationResult is either:
```ts
{ match: true; txId: string; block: number }
```
or
```ts
{ match: false; storedHash: string; computedHash: string; storedAt?: string }
```

Now, the service needs access to:
1. Anchor repository
2. Chain client
3. Canonicalization function

And possibly DocumentVersion repository to look up the stored content.

Actually wait - when we anchor, we need the content to compute the hash. Where does the content come from? Two options:
1. The content is passed as a parameter to anchorDocument
2. The content is looked up from the DocumentVersion table

Looking at the task: "anchorDocument(documentId, version)" - no content parameter. So the content must be stored somewhere (DocumentVersion table) and retrieved.

But for verify: "verify(documentId, version, content)" - content IS passed.

So the flow is:
- Document versions are created separately (storing structured content)
- anchorDocument retrieves content from DB, computes hash, prepares, persists, broadcasts
- verify receives content as parameter, computes hash, compares with stored anchor

Let me add a DocumentVersion repository too.

Actually, to keep it simpler and since the task doesn't specify a separate endpoint for creating document versions, let me have the controller accept the content in the anchor endpoint. But then anchorDocument would need both the content AND the documentId/version. Let me re-read the spec:

"anchorDocument(documentId, version) — computes a canonical hash of the structured content"

The content must come from somewhere. Let me have a DocumentVersion model/table and the service retrieves it.

For tests, I'll first create a document version, then anchor it.

Let me write it all now. I'll be comprehensive.

Let me also define the error codes:
- `anchor_already_exists` - trying to anchor a (document, version) that already has an anchor
- `document_version_not_found` - no document version exists for the given (document, version)
- `anchor_not_found` - no anchor exists
- `verification_mismatch` - content hash doesn't match

OK here we go. Let me write every file.

Actually, let me also think about how the `signedTx` is generated by the mock chain client. The `prepare` function takes some input (the transaction payload) and returns `{txId, signedTx}`. In the mock:

```ts
prepare(input: unknown): { txId: string; signedTx: string } {
  const txId = uuid();
  const signedTx = `signed-${txId}`;
  // store the prepared transaction
  this.preparedTransactions.set(txId, { txId, signedTx, input });
  return { txId, signedTx };
}
```

And for broadcast:
```ts
async broadcast(signedTx: string): Promise<void> {
  // simulate timeout
  if (this.shouldTimeout) throw new Error('timeout');
  // track that this signedTx was broadcast
  this.broadcastedTransactions.add(signedTx);
  // create a pending receipt
  this.pendingReceipts.set(signedTx, { txId: ..., block: ..., success: true });
}
```

Hmm, but the mock needs to be flexible enough for different test scenarios. Let me make it configurable.

Let me define the mock with these capabilities:
- `shouldBroadcastTimeout: boolean` - if true, broadcast throws
- `receipts: Map<string, Receipt>` - pre-configured receipts for txIds
- `broadcastedSignedTxs: Set<string>` - track all signed txs that were broadcast
- `prepareCalledWith: Array<unknown>` - track all prepare calls
- After a "crash" (method `simulateCrash()`), reset in-memory state but keep receipts

Let me finalize this design and write the code.

I think I have a good enough mental model now. Let me write all the files.

One more consideration: the `getReceipt(txId)` in the mock. After broadcast:
- If broadcast succeeded and we want receipt to exist: we need the txId. The mock chain needs to know the mapping from signedTx to txId. Since `prepare` returns both, the mock can track this.

Let me design the mock more carefully:

```ts
class MockChainClient implements ChainClient {
  private prepared = new Map<string, { txId: string; signedTx: string; input: unknown }>();
  private broadcasted = new Set<string>(); // signedTx values
  private receipts = new Map<string, Receipt>(); // txId -> receipt
  private broadcastTimeout = false;
  
  prepare(input: unknown): { txId: string; signedTx: string } {
    const txId = uuid();
    const signedTx = `signed-${txId}`;
    this.prepared.set(txId, { txId, signedTx, input });
    return { txId, signedTx };
  }
  
  async broadcast(signedTx: string): Promise<void> {
    if (this.broadcastTimeout) {
      throw new Error('Broadcast timed out');
    }
    this.broadcasted.add(signedTx);
  }
  
  async getReceipt(txId: string): Promise<Receipt | null> {
    return this.receipts.get(txId) ?? null;
  }
  
  // Test helpers
  setBroadcastTimeout(value: boolean) { this.broadcastTimeout = value; }
  setReceipt(txId: string, receipt: Receipt) { this.receipts.set(txId, receipt); }
  getBroadcastedSignedTxs(): string[] { return [...this.broadcasted]; }
  
  // Simulate process crash: reset in-memory broadcast tracking
  simulateCrash() {
    this.broadcasted.clear();
  }
}
```

This works well. After crash:
- `broadcasted` is cleared (in-memory state lost)
- But `prepared` and `receipts` persist (they represent the chain state)
- Actually, `prepared` is also in-memory. After crash, we lose it too.
- BUT: the anchor in the DB has the txId, so we can still query getReceipt(txId)
- The `receipts` map represents the actual chain state, which persists even after crash

Wait, but in the spec: "query `getReceipt(txId)` before doing anything else". The mock's getReceipt queries the `receipts` map. After crash, if `receipts` still has the entry, getReceipt will return it. Good.

But if we simulate the chain not having accepted the transaction (for the re-broadcast test), `receipts` won't have the txId. Then recovery sweep will re-broadcast. After re-broadcast, `broadcasted` set will have the signedTx again (but it was cleared by crash, so it starts fresh).

This all works. Let me now write the full code.

Let me also decide on the `prisma/migrations` structure. I'll include a basic migration file.

OK, writing now. Let me keep things focused and clean.

For Prisma, I'll use:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Now, the complete code. Let me be methodical.

Let me also add an `ErrorInterceptor` or use a custom exception class for the error envelope. In NestJS, I can use `@Catch` decorator.

```ts
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message = exception instanceof HttpException ? exception.message : 'Internal error';
    const code = exception instanceof ApiError ? exception.code : 'internal_error';
    response.status(status).json({
      error: { code, message, details: {} }
    });
  }
}
```

And:
```ts
export class ApiError {
  constructor(
    public code: string,
    public message: string,
    public details: Record<string, unknown> = {}
  ) {}
}
```

OK let me now write everything. I'll keep the code clean and well-organized. Let me start with the most foundational files and work up.

I think for the test file, I should name it `test/anchor.spec.ts` per the convention `test/<feature>.spec.ts`.

Let me finalize the file list and write everything:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/chain/chain.interface.ts`
5. `src/canonicalization/canonicalization.ts`
6. `src/anchor/anchor.repository.ts`
7. `src/anchor/anchor.service.ts`
8. `src/anchor/anchor.worker.ts`
9. `src/anchor/anchor.recovery.ts`
10. `src/anchor/anchor.module.ts`
11. `src/anchor/anchor.controller.ts`
12. `test/anchor.spec.ts`

I'll skip the error filter as a separate file and handle it inline in the controller or use a simpler approach.

Actually, let me reconsider the structure. The app module needs to wire everything together. Let me plan the module imports:

AppModule imports AnchorModule.
AnchorModule provides:
- AnchorService
- AnchorRepository
- AnchorWorker
- AnchorRecovery
- ChainClient (using MockChainClient for tests, but in production would use real)
- AnchorController

Actually, for the chain client, in production it would be a real implementation, and in tests we'd use the mock. Let me provide both and use a provider factory or just have the mock be the default in tests.

In NestJS, I can use `forRoot` pattern or just provide both and use `@Inject` with a token.

Let me use an injection token:

```ts
export const CHAIN_CLIENT = Symbol('CHAIN_CLIENT');
```

In AnchorModule:
```ts
providers: [
  AnchorService,
  AnchorRepository,
  AnchorWorker,
  AnchorRecovery,
  { provide: CHAIN_CLIENT, useClass: MockChainClient }, // default for tests
  AnchorController,
]
```

In tests, we can override with `Test.createTestingModule.overrideProvider(CHAIN_CLIENT).useMockValue(mockClient)`.

Actually, since we want to use a fresh mock for each test, let me just provide the mock class and instantiate it in each test.

Let me now write everything out. I'll aim for clean, production-quality code.

Here's my final plan for each file. Let me write them all now.

Wait, one more thing. For the Prisma schema, the Anchor model needs:
- Unique constraint on (documentId, version)
- States: PREPARED, BROADCAST_SENT, BROADCAST_TIMEOUT, CONFIRMED, FAILED
- Fields: documentId, version, canonicalHash, txId, signedTx, state, block (optional), createdAt, confirmedAt (optional)

The DocumentVersion model needs:
- documentId, version, content (Json)
- Unique constraint on (documentId, version)

Let me write it all now. Going to be comprehensive.

Oh wait, I should also think about: what's in the `signedTx` string? In the mock, it's just a string. In production, it would be a real signed transaction hex. The important thing is that the same content produces the same signedTx (because prepare is deterministic), and we can re-broadcast it.

The spec says: "Only if the chain has no trace may the same signed transaction be re-broadcast — the same one, not a new one". This is important because if we generated a new txId via prepare again, we'd have a different transaction on chain, potentially causing confusion. By re-broadcasting the same signedTx, the chain will recognize it as the same transaction.

OK, writing everything now. No more planning.

Let me think about one more edge case: what happens if `anchorDocument` is called and an anchor already exists for (documentId, version)? It should be rejected. Since we have a unique constraint in the DB, a second attempt will throw a Prisma unique constraint error, which we'll catch and convert to a proper error response.

Also, what if the document version doesn't exist? We should throw `document_version_not_found`.

And for `verify`: what if no anchor exists? Return a mismatch or a "not anchored" report? The spec says "return either the anchoring proof or a mismatch report". If no anchor exists, it's a mismatch (the hash won't match anything).

OK, truly writing now.

Let me also consider the controller endpoints:
- POST /anchor/:documentId/versions/:version → anchorDocument (gets content from DocumentVersion table)
- POST /anchor/:documentId/versions/:version/verify → verify (receives content in body)
- POST /anchor/recovery-sweep → trigger recovery sweep
- POST /anchor/confirm → trigger confirmation worker

Actually, let me simplify:
- POST /documents/:documentId/versions/:version/anchor → anchorDocument
- POST /documents/:documentId/versions/:version/verify → verify
- POST /anchor/recovery → trigger recovery sweep
- POST /anchor/confirm → trigger worker

Hmm, let me look at the spec naming. The endpoint should be kebab-case and plural. Since these are resource actions, not CRUD:
- POST /anchor-document (with documentId and version in body or path)

Let me keep it simple and use path params:
- POST /documents/:documentId/versions/:version/anchor
- POST /documents/:documentId/versions/:version/verify
- POST /anchor/recovery-sweep
- POST /anchor/confirm

OK, final code time.

Let me also handle the `canonicalization written down` requirement. The spec says: "the canonicalization written down". I'll include comments in the canonicalization module that document the algorithm clearly. This serves as the written-down specification.

Now let me write all the files:

Actually, I want to be careful about one thing. The spec says "proven by a test that crashes the process between broadcast and the (wrong) late persist a naive design would do."

So the test scenario is:
1. Our implementation: anchorDocument persists anchor intent BEFORE broadcast
2. After persist, broadcast is called
3. "Crash" - process state is lost (mock chain client loses track of broadcasts)
4. "Restart" - new mock chain client that can look up receipts
5. Recovery sweep runs
6. Verify: exactly one anchor exists in DB, and it's confirmed

The "(wrong) late persist a naive design would do" means: in a naive design, the persist happens AFTER broadcast returns successfully. If broadcast times out, the persist never happens, and the anchor is lost. Our test shows that with our approach (persist before broadcast), even after a crash, the anchor can be recovered.

Let me now write everything.

Actually I realize I should also write the canonicalization test separately. Let me include it in the same test file or as a separate spec. The convention says `test/<feature>.spec.ts`, so I'll put canonicalization tests in `test/canonicalization.spec.ts` and the main integration tests in `test/anchor.spec.ts`.

OK, truly writing now. No more deliberation.

Let me also decide on a reasonable approach for running Prisma in tests. I'll use `PrismaClient` with `DATABASE_URL` pointing to a test database. For the test setup, I'll use beforeAll/beforeEach to set up data and afterAll to clean up.

Actually, I should be careful: creating a test for every Prisma migration might be too much. Let me just include the schema and a basic migration SQL, and use Prisma's standard approach.

Final list of files:
1. `prisma/schema.prisma`
2. `prisma/migrations/20240101000000_initial/migration.sql`
3. `src/main.ts`
4. `src/app.module.ts`
5. `src/chain/chain.interface.ts`
6. `src/canonicalization/canonicalization.ts`
7. `src/anchor/anchor.repository.ts`
8. `src/anchor/anchor.service.ts`
9. `src/anchor/anchor.worker.ts`
10. `src/anchor/anchor.recovery.ts`
11. `src/anchor/anchor.module.ts`
12. `src/anchor/anchor.controller.ts`
13. `src/chain/chain.mock.ts`
14. `test/anchor.spec.ts`

14 files. Manageable. Let me write them all.

Let me be very careful with the TypeScript types and Prisma types. I'll make sure everything compiles.

Starting with the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model DocumentVersion {
  id      String `@id @default(uuid())`
  documentId String
  version  String
  content  Json
  createdAt DateTime @default(now())
  
  @@unique([documentId, version])
  @@map("document_versions")
}

model Anchor {
  id            String   @id @default(uuid())
  documentId    String
  version       String
  canonicalHash String
  txId          String
  signedTx      String
  state         AnchorState
  block         Int?
  createdAt     DateTime @default(now())
  confirmedAt   DateTime?
  
  @@unique([documentId, version])
  @@map("anchors")
}

enum AnchorState {
  PREPARED
  BROADCAST_SENT
  BROADCAST_TIMEOUT
  CONFIRMED
  FAILED
}
```

Migration SQL:
```sql
-- Migration: initial
CREATE TABLE "document_versions" (
  "id" VARCHAR(255) PRIMARY KEY,
  "document_id" VARCHAR(255) NOT NULL,
  "version" VARCHAR(255) NOT NULL,
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_versions_document_id_version_unique" UNIQUE ("document_id", "version")
);

CREATE TYPE "anchor_state" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'BROADCAST_TIMEOUT', 'CONFIRMED', 'FAILED');

CREATE TABLE "anchors" (
  "id" VARCHAR(255) PRIMARY KEY,
  "document_id" VARCHAR(255) NOT NULL,
  "version" VARCHAR(255) NOT NULL,
  "canonical_hash" VARCHAR(64) NOT NULL,
  "tx_id" VARCHAR(255) NOT NULL,
  "signed_tx" TEXT NOT NULL,
  "state" "anchor_state" NOT NULL DEFAULT 'PREPARED',
  "block" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "confirmed_at" TIMESTAMP,
  CONSTRAINT "anchors_document_id_version_unique" UNIQUE ("document_id", "version")
);
```

Now the chain interface:

```ts
export interface ChainReceipt {
  txId: string;
  block: number;
  success: boolean;
}

export interface ChainClient {
  prepare(tx: unknown): { txId: string; signedTx: string };
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
```

The mock:

```ts
import { v4 as uuid } from 'uuid';
import type { ChainClient, ChainReceipt } from './chain.interface';

export class MockChainClient implements ChainClient {
  private prepared = new Map<string, { txId: string; signedTx: string; input: unknown }>();
  private broadcasted = new Set<string>();
  private chainReceipts = new Map<string, ChainReceipt>();
  private broadcastTimeout = false;

  prepare(tx: unknown): { txId: string; signedTx: string } {
    const txId = uuid();
    const signedTx = `signed-${txId}`;
    this.prepared.set(txId, { txId, signedTx, input: tx });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.broadcastTimeout) {
      throw new Error('broadcast timed out');
    }
    this.broadcasted.add(signedTx);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.chainReceipts.get(txId) ?? null;
  }

  // Test helpers
  setBroadcastTimeout(value: boolean): void {
    this.broadcastTimeout = value;
  }

  setReceipt(txId: string, receipt: ChainReceipt): void {
    this.chainReceipts.set(txId, receipt);
  }

  getBroadcastedSignedTxs(): string[] {
    return [...this.broadcasted];
  }

  wasBroadcast(signedTx: string): boolean {
    return this.broadcasted.has(signedTx);
  }

  /**
   * Simulate a process crash: lose all in-memory broadcast tracking.
   * Chain state (receipts) persists as it lives on the L2.
   */
  simulateCrash(): void {
    this.broadcasted.clear();
  }

  getPreparedTxId(): string | undefined {
    for (const { txId } of this.prepared.values()) {
      return txId;
    }
    return undefined;
  }
}
```

Canonicalization:

```ts
import { createHash } from 'crypto';

/**
 * Canonicalization algorithm (written-down specification):
 *
 * 1. Recursively normalize the value:
 *    a. Objects: sort all keys alphabetically (locale-independent, UTF-8 code point order).
 *       Recurse into each value.
 *    b. Arrays: preserve order, normalize each element recursively.
 *    c. Strings: use as-is (UTF-8).
 *    d. Numbers: use the shortest decimal representation that round-trips
 *       (JSON.stringify behavior in modern JS engines; no scientific notation
 *       for |n| < 1e21, no trailing zeros after decimal point).
 *    e. Booleans: lowercase ("true"/"false").
 *    f. Null: literal "null".
 * 2. Serialize as compact JSON (no whitespace, no key/value separators beyond ":" and ",").
 * 3. UTF-8 encode the resulting string.
 * 4. Compute SHA-256 of the encoded bytes.
 * 5. Return lowercase hex string.
 *
 * The PDF is a rendering of this structured content and is NOT used for hashing.
 * Any auditor can reproduce this hash from the structured JSON alone.
 */
export function canonicalHash(value: unknown): string {
  const normalized = normalize(value);
  const bytes = JSON.stringify(normalized);
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'boolean') return value;
  if (type === 'string') return value;
  if (type === 'number') return normalizeNumber(value);
  if (type === 'undefined') throw new Error('Cannot canonicalize undefined');
  if (Array.isArray(value)) return value.map(normalize);
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = normalize(obj[key]);
    }
    return sorted;
  }
  throw new Error(`Cannot canonicalize type: ${type}`);
}

function normalizeNumber(n: number): number {
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot canonicalize non-finite number: ${n}`);
  }
  return n;
}
```

Now the repository:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; // ASSUMPTION: standard Prisma service location
import type { Anchor, DocumentVersion, Prisma } from '@prisma/client';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAnchorIntent(
    data: Prisma.AnchorCreateInput & { documentId: string; version: string }
  ): Promise<Anchor> {
    return this.prisma.anchor.create({ data });
  }

  async findByDocumentAndVersion(documentId: string, version: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { txId },
    });
  }

  async updateState(
    documentId: string,
    version: string,
    state: Anchor['state'],
    patch?: Partial<Pick<Anchor, 'block' | 'confirmedAt'>>
  ): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { documentId_version: { documentId, version } },
      data: { state, ...patch },
    });
  }

  async createDocumentVersion(
    data: Prisma.DocumentVersionCreateInput & { documentId: string; version: string }
  ): Promise<DocumentVersion> {
    return this.prisma.documentVersion.create({ data });
  }

  async findDocumentVersion(
    documentId: string,
    version: string
  ): Promise<DocumentVersion | null> {
    return this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async findAllAnchors(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany();
  }
}
```

Wait, I need to create a PrismaService. Let me add that as a file or include it. Actually, let me create it in a standard location.

Let me add `src/prisma/prisma.service.ts`.

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
```

Actually, for tests, we might want to disconnect. Let me add that.

Let me also think about imports. The app needs to import PrismaService from somewhere. Let me put it in `src/prisma/prisma.service.ts`.

Now the service:

```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChainClient } from '../../chain/chain.interface';
import { canonicalHash } from '../../canonicalization/canonicalization';
import { AnchorRepository } from './anchor.repository';

export interface AnchorDocumentResult {
  anchorId: string;
  documentId: string;
  version: string;
  canonicalHash: string;
  txId: string;
  state: string;
}

export interface VerificationResult {
  match: boolean;
  txId?: string;
  block?: number;
  storedHash?: string;
  computedHash?: string;
}

@Injectable()
export class AnchorService {
  constructor(
    private readonly repository: AnchorRepository,
    private readonly chainClient: ChainClient,
    private readonly prisma: PrismaService,
  ) {}

  async anchorDocument(documentId: string, version: string): Promise<AnchorDocumentResult> {
    // 1. Find the document version content
    const docVersion = await this.repository.findDocumentVersion(documentId, version);
    if (!docVersion) {
      throw new HttpException(
        { error: { code: 'document_version_not_found', message: `No version ${version} found for document ${documentId}`, details: {} } },
        HttpStatus.NOT_FOUND,
      );
    }

    // 2. Check for existing anchor (schema-level uniqueness enforcement)
    const existing = await this.repository.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new HttpException(
        { error: { code: 'anchor_already_exists', message: `Anchor already exists for document ${documentId} version ${version}`, details: { anchorId: existing.id } } },
        HttpStatus.CONFLICT,
      );
    }

    // 3. Compute canonical hash
    const canonicalHash = canonicalHash(docVersion.content);

    // 4. Prepare transaction (local, deterministic - obtains tx identity)
    const { txId, signedTx } = this.chainClient.prepare({ documentId, version, canonicalHash });

    // 5. Persist anchor intent with tx identity (BEFORE broadcast) — this is the fix
    const anchor = await this.prisma.$transaction(async (tx) => {
      // Check again within transaction (race condition guard)
      const already = await tx.anchor.findUnique({
        where: { documentId_version: { documentId, version } },
      });
      if (already) {
        throw new HttpException(
          { error: { code: 'anchor_already_exists', message: 'Race condition: anchor was created concurrently', details: { anchorId: already.id } } },
          HttpStatus.CONFLICT,
        );
      }
      return tx.anchor.create({
        data: {
          id: crypto.randomUUID(),
          documentId,
          version,
          canonicalHash,
          txId,
          signedTx,
          state: 'PREPARED',
        },
      });
    });

    // 6. Broadcast the signed transaction
    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateState(documentId, version, 'BROADCAST_SENT');
    } catch {
      // Broadcast timed out — state remains PREPARED initially, but we mark it
      await this.repository.updateState(documentId, version, 'BROADCAST_TIMEOUT');
    }

    return {
      anchorId: anchor.id,
      documentId: anchor.documentId,
      version: anchor.version,
      canonicalHash: anchor.canonicalHash,
      txId: anchor.txId,
      state: anchor.state,
    };
  }

  async verify(documentId: string, version: string, content: unknown): Promise<VerificationResult> {
    const anchor = await this.repository.findByDocumentAndVersion(documentId, version);
    const computedHash = canonicalHash(content);

    if (!anchor) {
      return {
        match: false,
        storedHash: undefined,
        computedHash,
      };
    }

    if (anchor.canonicalHash === computedHash) {
      return {
        match: true,
        txId: anchor.txId,
        block: anchor.block ?? undefined,
      };
    }

    return {
      match: false,
      storedHash: anchor.canonicalHash,
      computedHash,
    };
  }
}
```

Hmm wait, I have an issue. The error format should be consistent with the error envelope: `{ "error": { "code": "...", "message": "...", "details": {} } }`. In NestJS, throwing HttpException with the full object means the response will be the exception object. Let me make sure this works correctly.

In NestJS, when you throw an HttpException, the response payload is whatever you pass to the constructor. So:
```ts
throw new HttpException({ error: { code, message, details } }, status);
```
This will produce `{ error: { code, message, details } }` with the given status. That's correct.

But wait, NestJS wraps it in its own format by default? No, it passes the body directly. Let me check: `new HttpException(body, status)` where body is the JSON object. The response will be exactly that body. Good.

Now the worker:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { ChainClient, ChainReceipt } from '../../chain/chain.interface';
import { AnchorRepository } from './anchor.repository';

@Injectable()
export class AnchorWorker {
  private readonly logger = new Logger('AnchorWorker');

  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  async confirmPending(): Promise<number> {
    let confirmed = 0;
    const anchors = await this.repository.findAllAnchors();

    for (const anchor of anchors) {
      if (anchor.state === 'CONFIRMED' || anchor.state === 'FAILED') {
        continue;
      }

      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        const state = receipt.success ? 'CONFIRMED' : 'FAILED';
        await this.repository.updateState(anchor.documentId, anchor.version, state, {
          block: receipt.block,
          confirmedAt: new Date(),
        });
        confirmed++;
        this.logger.log(`Anchor ${anchor.documentId}/${anchor.version}: ${state} at block ${receipt.block}`);
      }
    }

    return confirmed;
  }
}
```

Now the recovery sweep:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { ChainClient } from '../../chain/chain.interface';
import { AnchorRepository } from './anchor.repository';

@Injectable()
export class AnchorRecovery {
  private readonly logger = new Logger('AnchorRecovery');

  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  /**
   * Recovery sweep for anchors stuck in PREPARED or BROADCAST_TIMEOUT.
   * Per spec: query getReceipt(txId) BEFORE doing anything else.
   * Only re-broadcast the SAME signed transaction if chain has no trace.
   */
  async recoverStuck(): Promise<number> {
    let recovered = 0;
    const anchors = await this.repository.findAllAnchors();

    for (const anchor of anchors) {
      if (anchor.state !== 'PREPARED' && anchor.state !== 'BROADCAST_TIMEOUT') {
        continue;
      }

      // Ask the chain first
      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        const state = receipt.success ? 'CONFIRMED' : 'FAILED';
        await this.repository.updateState(anchor.documentId, anchor.version, state, {
          block: receipt.block,
          confirmedAt: new Date(),
        });
        this.logger.log(`Recovery: anchor ${anchor.documentId}/${anchor.version} ${state} at block ${receipt.block}`);
        recovered++;
        continue;
      }

      // Chain has no trace — re-broadcast the SAME signed transaction
      try {
        await this.chainClient.broadcast(anchor.signedTx);
        await this.repository.updateState(anchor.documentId, anchor.version, 'BROADCAST_SENT');
        this.logger.log(`Recovery: re-broadcast anchor ${anchor.documentId}/${anchor.version}`);
        recovered++;
      } catch (err) {
        this.logger.error(`Recovery: re-broadcast failed for ${anchor.documentId}/${anchor.version}: ${err}`);
      }
    }

    return recovered;
```

Now the module:

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { AnchorWorker } from './anchor.worker';
import { AnchorRecovery } from './anchor.recovery';
import { AnchorController } from './anchor.controller';
import { MockChainClient } from '../../chain/chain.mock';
import type { ChainClient } from '../../chain/chain.interface';

@Module({
  imports: [],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorWorker,
    AnchorRecovery,
    AnchorController,
    PrismaService,
    { provide: ChainClient, useClass: MockChainClient },
  ],
  exports: [AnchorService, AnchorRepository],
})
export class AnchorModule {}
```

Wait, I should think about the module structure more carefully. The PrismaService should be in its own module or shared. Let me create a `PrismaModule` or just provide it directly. For simplicity, I'll provide it in the AnchorModule.

Actually, let me put PrismaService in a dedicated module at `src/prisma/prisma.module.ts`.

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

And in app.module.ts:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AnchorModule } from './anchor/anchor.module';

@Module({
  imports: [PrismaModule, AnchorModule],
})
export class AppModule {}
```

And in AnchorModule:
```ts
@Module({
  imports: [PrismaModule],
  // ...
})
```

Now the controller:

```ts
import { Controller, Post, Param, Body, Query } from '@nestjs/common';
import { AnchorService } from './anchor.service';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchorDocument(@Param('documentId') documentId: string, @Param('version') version: string) {
    return this.anchorService.anchorDocument(documentId, version);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(@Param('documentId') documentId: string, @Param('version') version: string, @Body() body: { content: unknown }) {
    return this.anchorService.verify(documentId, version, body.content);
  }

  @Post('recovery-sweep')
  async recoverySweep() {
    // Need access to AnchorRecovery - let me inject it
  }

  @Post('confirm')
  async confirm() {
    // Need access to AnchorWorker
  }
}
```

Let me inject both recovery and worker:

```ts
import { Controller, Post, Param, Body } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { AnchorWorker } from './anchor.worker';
import { AnchorRecovery } from './anchor.recovery';

@Controller('anchor')
export class AnchorController {
  constructor(
    private readonly anchorService: AnchorService,
    private readonly anchorWorker: AnchorWorker,
    private readonly anchorRecovery: AnchorRecovery,
  ) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchorDocument(@Param('documentId') documentId: string, @Param('version') version: string) {
    return this.anchorService.anchorDocument(documentId, version);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(@Param('documentId') documentId: string, @Param('version') version: string, @Body() body: { content: unknown }) {
    return this.anchorService.verify(documentId, version, body.content);
  }

  @Post('recovery-sweep')
  async recoverySweep() {
    const recovered = await this.anchorRecovery.recoverStuck();
    return { recovered };
  }

  @Post('confirm')
  async confirm() {
    const confirmed = await this.anchorWorker.confirmPending();
    return { confirmed };
  }
}
```

Now main.ts:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

Now the test file. This is the most important one. Let me design the tests carefully.

Test scenarios:
1. **Intent persisted before broadcast**: When `anchorDocument` is called, the anchor is in PREPARED state with a txId, and `broadcast` has NOT yet been called (or is called after persist).
2. **Broadcast timeout but landed → recovery confirms**: broadcast throws (timeout), but getReceipt returns receipt. After calling anchorDocument, run recovery sweep, anchor becomes CONFIRMED. No re-broadcast happened.
3. **Broadcast timeout and didn't land → re-broadcast**: broadcast throws, getReceipt returns null. Recovery sweep re-broadcasts same signedTx. Only one anchor.
4. **Crash between broadcast and confirmation → restart recovers**: anchorDocument (with broadcast timeout), simulate crash on mock (clear broadcast tracking), create fresh mock that returns receipt, run recovery. One anchor total, confirmed.
5. **Duplicate anchor rejected**: Try to anchor same (document, version) twice → second attempt fails with 409.
6. **Verify matching content**: Returns proof with txId and block.
7. **Verify mismatch**: Returns mismatch report.

Wait, for test 4 (crash test), I need to be careful. The mock's state is lost on "crash", but the DB persists. After crash, I create a new mock chain client that can still answer getReceipt. Let me think about how to do this in a test.

```ts
test('crash between broadcast and confirmation → restart recovers, one anchor total', async () => {
  // Create document version
  // ...
  
  // Set up chain: broadcast will timeout
  mockChain.setBroadcastTimeout(true);
  
  // Anchor document - this persists PREPARED before broadcasting
  await anchorService.anchorDocument('doc-1', 'v1');
  
  // Simulate crash: lose in-memory broadcast tracking
  mockChain.simulateCrash();
  
  // "Restart" - create new chain client that knows about the chain state
  // (the receipt is on the "chain" so it persists in mockChain.chainReceipts)
  // Actually, since we're using the same mockChain object, the chainReceipts are still there
  // We need to set the receipt for the txId
  
  // Find the txId from the anchor
  const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
  mockChain.setReceipt(anchor.txId, { txId: anchor.txId, block: 12345, success: true });
  
  // Run recovery sweep
  await anchorRecovery.recoverStuck();
  
  // Verify: exactly one anchor, confirmed
  const anchors = await anchorRepository.findAllAnchors();
  expect(anchors).toHaveLength(1);
  expect(anchors[0].state).toBe('CONFIRMED');
  expect(anchors[0].block).toBe(12345);
});
```

Wait, but in my mock, `simulateCrash()` only clears `broadcasted` (the set of tracked broadcasts). The `chainReceipts` map persists. So after crash, getReceipt still works. And `prepared` also persists. The "crash" is just losing track of what was broadcast - which is the in-memory state that the bug was about.

Actually, let me reconsider what "crash" means here. The spec says "crashes the process between broadcast and the (wrong) late persist". In the naive design, the persist happens after broadcast. So if the process crashes during broadcast (or right after), the anchor is never persisted. In our design, the anchor IS persisted, so after restart we can recover it.

The test should show:
1. After anchorDocument: anchor exists in DB (PREPARED state with txId) ← our design persists BEFORE broadcast
2. "Crash" means in-memory state is lost (mock chain loses its broadcast tracking)
3. "Restart" means new services are created, reading from DB
4. Recovery sweep queries chain for the txId → finds receipt → confirms anchor
5. Result: exactly one anchor in DB, confirmed

The key comparison: a naive design would have 0 anchors after this scenario. Our design has 1.

Let me write the test properly now.

Also, I need to set up the test with a real Prisma connection. Let me use a real Postgres or Prisma's test utilities. For simplicity, I'll assume DATABASE_URL is set and use PrismaClient directly.

Let me also create a DocumentVersion in the test before anchoring.

Here's my test structure:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnchorModule } from '../src/anchor/anchor.module';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorRepository } from '../src/anchor/anchor.repository';
import { AnchorWorker } from '../src/anchor/anchor.worker';
import { AnchorRecovery } from '../src/anchor/anchor.recovery';
import { MockChainClient } from '../src/chain/chain.mock';
import type { ChainClient } from '../src/chain/chain.interface';

describe('Anchor Service', () => {
  let module: TestingModule;
  let anchorService: AnchorService;
  let anchorRepository: AnchorRepository;
  let anchorWorker: AnchorWorker;
  let anchorRecovery: AnchorRecovery;
  let mockChain: MockChainClient;
  let prisma: PrismaService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AnchorModule],
    }).compile();

    anchorService = module.get<AnchorService>(AnchorService);
    anchorRepository = module.get<AnchorRepository>(AnchorRepository);
    anchorWorker = module.get<AnchorWorker>(AnchorWorker);
    anchorRecovery = module.get<AnchorRecovery>(AnchorRecovery);
    mockChain = module.get<ChainClient>(ChainClient) as MockChainClient;
    prisma = module.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    // Clean up DB
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    // Reset mock chain
    mockChain.setBroadcastTimeout(false);
    // Clear any receipts
    // We can't easily clear the Map from outside, so let's use a fresh mock
  });
  
  // ...
});
```

Hmm, the mock is shared via the module provider. For test isolation, I might need to create a fresh mock for each test. Let me use `overrideProvider` in beforeEach.

Actually, let me simplify by creating a fresh mock in beforeEach and overriding the provider.

Wait, that's complex. Let me instead just reset the mock's state. Let me add a `reset()` method to the mock:

```ts
reset(): void {
  this.prepared.clear();
  this.broadcasted.clear();
  this.chainReceipts.clear();
  this.broadcastTimeout = false;
}
```

And call it in beforeEach.

OK let me finalize and write everything now. I'll be thorough.

One more thing about the error format in the controller: NestJS will serialize the HttpException argument as the response body. So:

```ts
throw new HttpException(
  { error: { code: 'anchor_already_exists', message: '...', details: {} } },
  HttpStatus.CONFLICT
);
```

The response body will be:
```json
{
  "error": {
    "code": "anchor_already_exists",
    "message": "...",
    "details": {}
  }
}
```

with status 409. Correct.

Now let me also think about what happens when `anchorDocument` is called and the broadcast succeeds (no timeout). The flow:
1. Compute hash ✓
2. Prepare → {txId, signedTx} ✓
3. Persist anchor (PREPARED state, with txId) ✓
4. Broadcast → succeeds
5. Update state → BROADCAST_SENT ✓

The worker will then poll getReceipt for BROADCAST_SENT anchors and confirm them.

What if broadcast succeeds and we DON'T run the worker? The anchor stays in BROADCAST_SENT until the worker runs. That's fine.

What if broadcast throws (timeout)? The flow:
1. Compute hash ✓
2. Prepare → {txId, signedTx} ✓
3. Persist anchor (PREPARED state, with txId) ✓
4. Broadcast → throws → catch
5. Update state → BROADCAST_TIMEOUT ✓

The recovery sweep will then handle BROADCAST_TIMEOUT anchors.

Wait, but what about the worker? Should the worker also handle PREPARED anchors (in case broadcast was never attempted due to some error)? Let me have the worker handle all non-terminal states: PREPARED, BROADCAST_SENT, BROADCAST_TIMEOUT.

In my worker code, I check `if (anchor.state === 'CONFIRMED' || anchor.state === 'FAILED')` and skip those. So it handles all other states. Good.

Now let me also consider: what if broadcast succeeds but then the process crashes before we can update the state to BROADCAST_SENT? The anchor is in PREPARED state. The recovery sweep will query getReceipt. If receipt found → CONFIRMED. If not → re-broadcast same signedTx. This handles the crash scenario too.

But wait, if broadcast succeeded (it didn't throw), then after the crash and restart, getReceipt should return the receipt (because the chain accepted it). So recovery will confirm it. ✓

If broadcast timed out (it threw), and we crash, recovery will query getReceipt. 
- If chain has it → CONFIRMED (it actually landed despite the timeout)
- If chain doesn't have it → re-broadcast same signedTx

Both cases work correctly. ✓

OK, I'm now going to write all the final code. Let me be careful about TypeScript types and Prisma types.

Let me also handle one edge case: in `anchorDocument`, the `Prisma.$transaction` call. If the transaction succeeds but broadcast throws, the anchor is already persisted in PREPARED state. Then we catch and set BROADCAST_TIMEOUT. Good.

But there's a subtle issue: within the transaction, I'm doing `tx.anchor.create()`. But then outside the transaction, I call `this.chainClient.broadcast()`. If broadcast throws, I call `this.repository.updateState()` which uses the main Prisma client, not the transaction. That's fine since the transaction is already committed.

Let me now write all files. I'll organize them properly.

One more thing: I need to make sure `crypto.randomUUID()` works in Node 20. Yes, it does.

OK, let me also create a proper `PrismaModule` and adjust things.

Actually, I realize I've been going back and forth. Let me just write the final code now, all at once, carefully.

For the test, I realize I should also test the "broadcast success" path where the worker confirms the anchor. And the "duplicate anchor" test. And the "verify" tests.

Let me finalize the test plan:

```
describe('Anchor Service', () => {
  // Setup
  
  describe('canonicalization', () => {
    test('deterministic: same input → same hash', () => { ... });
    test('key ordering: different key order → same hash', () => { ... });
    test('number formatting', () => { ... });
    test('whitespace-insensitive', () => { ... });
  });
  
  describe('anchorDocument', () => {
    test('persists intent with txId before broadcast', async () => { ... });
    test('rejects duplicate (document, version) anchor', async () => { ... });
    test('throws when document version not found', async () => { ... });
    
    describe('state transitions', () => {
      test('after successful broadcast → BROADCAST_SENT', async () => { ... });
      test('after broadcast timeout → BROADCAST_TIMEOUT', async () => { ... });
    });
  });
  
  describe('confirmation worker', () => {
    test('confirms anchor when receipt exists', async () => { ... });
  });
  
  describe('recovery sweep', () => {
    test('broadcast timeout but landed → confirm from receipt, no re-broadcast', async () => { ... });
    test('broadcast timeout and did not land → re-broadcast same signedTx, one anchor', async () => { ... });
    test('crash between broadcast and confirmation → restart recovers, one anchor total', async () => { ... });
  });
  
  describe('verify', () => {
    test('matching content → returns proof with txId and block', async () => { ... });
    test('mismatching content → returns mismatch report', async () => { ... });
    test('no anchor → returns mismatch report', async () => { ... });
  });
});
```

This is comprehensive. Let me write it all.

I need to be mindful of one thing in the tests: after each test, I should clean up the DB. And I need to properly reset the mock between tests.

Let me also think about how the "crash between broadcast and confirmation" test works precisely:

1. Create mockChain with `broadcastTimeout = true`
2. Create document version
3. Call `anchorDocument('doc-1', 'v1')` → persists PREPARED with txId, broadcast fails, state = BROADCAST_TIMEOUT
4. Save the txId
5. "Crash": reset mockChain completely (simulating process restart)
6. Create NEW mockChain instance (simulating new process)
7. Set receipt on the new mock for the saved txId (simulating chain has it)
8. Recreate services with the new mock? 

Hmm, this is tricky in a NestJS test. The services are already wired with the old mock. In a real crash + restart, the entire app restarts and re-reads from DB.

For the test, I think the simplest approach is:
1. Don't actually recreate services (they're already in the test module)
2. Instead, just reset the mock's internal state and configure it fresh
3. Run recovery sweep with the freshly-configured mock
4. Assert results

Since the mock's `getReceipt` reads from `chainReceipts` (which we'll set after reset), and the `broadcast` method is fresh, this simulates the crash + restart correctly.

Let me add a `reset()` method:

```ts
reset(): void {
  this.prepared.clear();
  this.broadcasted.clear();
  this.chainReceipts.clear();
  this.broadcastTimeout = false;
}
```

Test flow:
1. mockChain.setBroadcastTimeout(true)
2. anchorDocument → anchor in BROADCAST_TIMEOUT with txId
3. const txId = anchor.txId
4. mockChain.reset() — simulates crash losing all in-memory state
5. mockChain.setReceipt(txId, { txId, block: 42, success: true }) — simulates new process querying chain
6. await anchorRecovery.recoverStuck() → queries getReceipt(txId), finds it, confirms
7. Assert: one anchor, CONFIRMED, block 42

And for the re-broadcast test:
1. mockChain.setBroadcastTimeout(true)
2. anchorDocument → BROADCAST_TIMEOUT
3. const txId = anchor.txId, const signedTx = anchor.signedTx
4. await anchorRecovery.recoverStuck() → getReceipt returns null, re-broadcasts signedTx
5. Assert: anchor is BROADCAST_SENT, mockChain.wasBroadcast(signedTx) is true
6. mockChain.setReceipt(txId, { txId, block: 99, success: true })
7. await anchorWorker.confirmPending() → confirms
8. Assert: CONFIRMED, block 99
9. Assert: still one anchor

This works! The recovery sweep re-broadcasts, then the worker confirms when receipt is available.

OK, I think I have a complete plan. Let me write everything now.

Let me also be careful about one thing: the `updateState` method in the repository takes an optional `patch` parameter. In my code, I call it with `{ block: receipt.block, confirmedAt: new Date() }`. But Prisma's `update` method takes specific field names. Let me make sure the types align.

Actually, let me just make the repository method straightforward:

```ts
async updateState(
  documentId: string,
  version: string,
  state: Anchor['state'],
  patch?: { block?: number; confirmedAt?: Date }
): Promise<Anchor> {
  const data: Prisma.AnchorUpdateInput = { state };
  if (patch) {
    if (patch.block !== undefined) data.block = patch.block;
    if (patch.confirmedAt !== undefined) data.confirmedAt = patch.confirmedAt;
  }
  return this.prisma.anchor.update({
    where: { documentId_version: { documentId, version } },
    data,
  });
}
```

Hmm, actually let me think about this differently. The Prisma types should handle this. Let me just use proper Prisma types.

OK, let me now write all the code, finally. I'll be careful with types.

I realize I should also consider: for the `confirm` endpoint in the controller, should it also handle recovery? No, they're separate: confirm = worker polling receipts, recovery = sweep for stuck anchors.

Let me write everything now. Here goes:

---

Actually, let me reconsider the anchor state transitions after the initial persist. When I call `anchorDocument`:
- In the try block (broadcast succeeds): update to BROADCAST_SENT
- In the catch block (broadcast fails): update to BROADCAST_TIMEOUT

But what if broadcast succeeds but then `updateState` fails? The anchor is in PREPARED state but broadcast actually succeeded. This is a rare edge case that the worker would handle (it would find receipt and confirm).

What if the process crashes between the catch block and the updateState call in the catch block? The anchor is in PREPARED state. After restart, recovery sweep would query getReceipt and either confirm or re-broadcast. This is correct.

What if the process crashes between broadcast returning and the catch block? The anchor is in PREPARED state. Same as above.

Good, the design is robust.

Now, let me also think about one more subtle thing: in `anchorDocument`, after persisting in PREPARED state, I call broadcast. If broadcast succeeds, I update to BROADCAST_SENT. But what if the process crashes between persisting and broadcasting? The anchor is in PREPARED state. After restart, the worker or recovery sweep will handle it (it's a "not yet broadcast" state). The worker will query getReceipt, find no receipt, and... what? Stay in PREPARED? Or update to BROADCAST_SENT?

In my current worker, it queries getReceipt. If no receipt, it does nothing (stays in PREPARED). That's a problem: the anchor would never be broadcast.

Let me fix this: the worker should also handle PREPARED state by attempting to broadcast:

```ts
async confirmPending(): Promise<number> {
  let processed = 0;
  const anchors = await this.repository.findAllAnchors();

  for (const anchor of anchors) {
    if (anchor.state === 'CONFIRMED' || anchor.state === 'FAILED') {
      continue;
    }

    // Check chain first
    const receipt = await this.chainClient.getReceipt(anchor.txId);
    if (receipt) {
      const state = receipt.success ? 'CONFIRMED' : 'FAILED';
      await this.repository.updateState(anchor.documentId, anchor.version, state, {
        block: receipt.block,
        confirmedAt: new Date(),
      });
      processed++;
      continue;
    }

    // No receipt yet — for PREPARED anchors, attempt broadcast
    if (anchor.state === 'PREPARED') {
      try {
        await this.chainClient.broadcast(anchor.signedTx);
        await this.repository.updateState(anchor.documentId, anchor.version, 'BROADCAST_SENT');
      } catch {
        await this.repository.updateState(anchor.documentId, anchor.version, 'BROADCAST_TIMEOUT');
      }
      processed++;
    }
  }

  return processed;
}
```

Hmm, but this mixes concerns. The worker should just check receipts. The recovery sweep should handle re-broadcasting. Let me keep them separate:

- Worker: poll receipts for BROADCAST_SENT and BROADCAST_TIMEOUT anchors → confirm or fail
- Recovery: for PREPARED and BROADCAST_TIMEOUT anchors → check receipt, if not found, re-broadcast

This is cleaner. But what about a PREPARED anchor that never gets handled by either? Well, in production, either the worker runs periodically or the recovery sweep runs periodically. Both would be set up. And the recovery sweep handles PREPARED state (which the worker doesn't broadcast).

Actually, let me reconsider. The flow after anchorDocument:
1. If broadcast succeeds: state = BROADCAST_SENT → worker will confirm
2. If broadcast fails: state = BROADCAST_TIMEOUT → worker won't confirm (no receipt), recovery will re-broadcast

So BROADCAST_TIMEOUT anchors need the recovery sweep to re-broadcast them. And PREPARED anchors (if any exist) should also be handled by recovery.

The worker should ONLY check receipts and confirm/fail. It should NOT broadcast.

The recovery sweep should:
- For PREPARED/BROADCAST_TIMEOUT: query getReceipt first
  - If receipt: confirm/fail
  - If no receipt: re-broadcast → BROADCAST_SENT

And then after re-broadcast, the worker can confirm.

This is clean. Let me finalize.

So the worker ONLY processes BROADCAST_SENT and BROADCAST_TIMEOUT anchors (and PREPARED too, just checking receipts):

```ts
// Worker: just check receipts
async confirmPending(): Promise<number> {
  let confirmedCount = 0;
  const anchors = await this.repository.findAllAnchors();
  for (const anchor of anchors) {
    if (anchor.state === 'CONFIRMED' || anchor.state === 'FAILED') continue;
    const receipt = await this.chainClient.getReceipt(anchor.txId);
    if (receipt) {
      const state = receipt.success ? 'CONFIRMED' : 'FAILED';
      await this.repository.updateState(anchor.documentId, anchor.version, state, {
        block: receipt.block,
        confirmedAt: new Date(),
      });
      confirmedCount++;
    }
  }
  return confirmedCount;
}
```

Recovery sweep:
```ts
async recoverStuck(): Promise<number> {
  let recovered = 0;
  const anchors = await this.repository.findAllAnchors();
  for (const anchor of anchors) {
    if (anchor.state !== 'PREPARED' && anchor.state !== 'BROADCAST_TIMEOUT') continue;
    
    // Ask chain first
    const receipt = await this.chainClient.getReceipt(anchor.txId);
    if (receipt) {
      const state = receipt.success ? 'CONFIRMED' : 'FAILED';
      await this.repository.updateState(anchor.documentId, anchor.version, state, {
        block: receipt.block,
        confirmedAt: new Date(),
      });
      recovered++;
      continue;
    }
    
    // No trace on chain — re-broadcast SAME signed transaction
    try {
      await this.chainClient.broadcast(anchor.signedTx);
      await this.repository.updateState(anchor.documentId, anchor.version, 'BROADCAST_SENT');
      recovered++;
    } catch {
      // Re-broadcast failed, leave in current state for next attempt
    }
  }
  return recovered;
}
```

OK this is solid. Let me now write ALL the files.

One more thing: I need a way to look up an anchor by txId in the repository. Let me add that.

Also, let me add `findAllAnchors` with all fields needed.

Let me now actually write everything. I'll structure the response as the required format: heading + code block for each file.

Let me list all the files one more time:

1. `prisma/schema.prisma`
2. `prisma/migrations/20240101000000_initial/migration.sql`
3. `src/main.ts`
4. `src/app.module.ts`
5. `src/prisma/prisma.service.ts`
6. `src/prisma/prisma.module.ts`
7. `src/chain/chain.interface.ts`
8. `src/chain/chain.mock.ts`
9. `src/canonicalization/canonicalization.ts`
10. `src/anchor/anchor.repository.ts`
11. `src/anchor/anchor.service.ts`
12. `src/anchor/anchor.worker.ts`
13. `src/anchor/anchor.recovery.ts`
14. `src/anchor/anchor.module.ts`
15. `src/anchor/anchor.controller.ts`
16. `test/anchor.spec.ts`

That's 16 files. Let me write them all.

Let me make sure I'm not missing anything from the spec:
✓ anchorDocument with persist before broadcast
✓ Canonical hashing defined
✓ State machine (PREPARED, BROADCAST_SENT, CONFIRMED, FAILED, BROADCAST_TIMEOUT)
✓ Confirmation worker
✓ Recovery sweep (ask chain first, re-broadcast same signed tx)
✓ One anchor per (document, version) at schema level
✓ verify returns proof or mismatch
✓ Tests for all acceptance cases
✓ Canonicalization written down (in code comments)

OK, writing now.

Actually, let me also add an error interceptor/filter for the consistent error envelope. Or I can just make sure the service throws properly formatted HttpExceptions. Since the controller passes through the HttpException, and NestJS serializes the body as-is, the error envelope will be correct. No need for a filter.

Hmm wait, let me double-check. When you throw:
```ts
throw new HttpException({ error: { code, message, details } }, 409);
```

The response body will be exactly `{ error: { code, message, details } }` with status 409. Yes, that's correct for NestJS.

OK, writing all files now. I'll be efficient.

For the test, I need to also handle creating document versions. Let me have the test call `prisma.documentVersion.create()` directly to set up test data, rather than exposing a controller endpoint for it.

Also: do I need a `DocumentVersionService` or controller? Not per the spec. I'll just create them directly in tests via Prisma.

Wait, but `anchorDocument` calls `repository.findDocumentVersion()` which uses Prisma. So the test needs to create a DocumentVersion in the DB. That's fine, I'll do it in beforeEach or in each test.

Let me finalize the test:

```ts
beforeEach(async () => {
  await prisma.anchor.deleteMany();
  await prisma.documentVersion.deleteMany();
  mockChain.reset();
});
```

And in each test, I'll create the document version as needed.

Now, truly, let me write all the code. I'll start from the most foundational and build up.

Let me also think about whether I need a `@PrismaClientExtension` or anything special. No, the standard PrismaClient is fine.

One issue: `PrismaService extends PrismaClient`. The `$connect()` in `onModuleInit` establishes the connection. In tests, this should work if DATABASE_URL is set.

For tests, I'll assume DATABASE_URL points to a test database. I'll also add a `beforeAll` to ensure the connection is ready.

OK, writing. For real this time.

Wait, also: I should handle the case where `prisma.$connect()` fails or we need to disconnect in tests. Let me add an `afterAll` hook. But since the module is shared across tests, I'll disconnect in the very end.

Actually, let me use `prisma.$disconnect()` in afterAll.

Now let me finalize and write everything. Here's the complete code:

Let me think carefully about the AnchorService's anchorDocument method one more time. There's a subtle issue with the state transition on broadcast failure. If broadcast fails, I want to set BROADCAST_TIMEOUT. But what if broadcast fails for a different reason (not timeout)? Let me treat all broadcast failures as BROADCAST_TIMEOUT, since from our perspective, we don't know if the broadcast was received or not. This aligns with the spec: "broadcast may time out with unknown outcome" and we need a state for "broadcast attempted, outcome unknown".

So: any exception from broadcast → BROADCAST_TIMEOUT. This is correct.

And in the recovery sweep: BROADCAST_TIMEOUT anchors get getReceipt checked first, then re-broadcasted if no receipt. This handles both the "landed despite timeout" and "didn't land, needs re-broadcast" cases.

Perfect. Now let me truly write everything.

Let me also decide how the mock handles re-broadcast. When recovery calls `mockChain.broadcast(signedTx)` after it was previously cleared by crash:
- The mock just adds it to `broadcasted` set
- If `broadcastTimeout` is true, it throws
- If false, it succeeds

For the re-broadcast test: after crash + reset, broadcastTimeout is false (we reset it). So recovery re-broadcast succeeds. Anchor goes to BROADCAST_SENT. ✓

For the "landed despite timeout" test: after anchorDocument with timeout, recovery runs, getReceipt returns receipt, anchor confirmed. No re-broadcast. ✓

Let me now write all code. I promise this is the last time I deliberate.

Final structure check: the spec says `test/<feature>.spec.ts`. My feature is "anchor", so `test/anchor.spec.ts`. ✓

Also, I should include canonicalization tests in the same file or separate. Let me put them in `test/canonicalization.spec.ts`.

OK, final answer. Let me write all 17 files.

Wait, I also want to double-check: does the spec mention the `verify` endpoint being in the controller? "6. verify(documentId, version, content) — recomputes the hash and returns the anchoring proof". This is a service method exposed via controller. ✓

And "4. Exactly one anchor per (document, version), enforced at the schema level, and proven by a test". The unique constraint is in the schema. ✓

Let me also make sure my Prisma schema has the `@@unique([documentId, version])` on the Anchor model. Yes. ✓

And in the migration, the unique constraint is created. Yes. ✓

OK, writing now. Final final answer.

One more: for the `@map` directives in Prisma, the spec says "Table and column: snake_case (via Prisma @map/@@map)". Let me add `@@map` to each model and `@map` to each field? Actually, Prisma automatically maps camelCase model/field names to snake_case table/column names by convention. The `@map` directive is only needed for special cases. Let me add `@@map` to models to explicitly specify the table names:

```prisma
model DocumentVersion {
  // ...
  @@unique([documentId, version])
  @@map("document_versions")
}

model Anchor {
  // ...
  @@unique([documentId, version])
  @@map("anchors")
}
```

This is sufficient. Prisma will auto-map camelCase fields to snake_case columns.

Now, the `enum AnchorState` also needs a table name? No, enums in PostgreSQL are separate types, not tables. Let me add `@@map` for the enum? Actually in Prisma, enums don't need `@@map`. The enum type in PostgreSQL will be `anchor_state` by convention.

OK, writing. For real. All files now.

Hmm, I realize the `state` field in the Anchor model will be stored as `anchor_state` in PostgreSQL (the enum type). The column name will be `state` → Prisma will map it to `state` (no auto-snake case needed since it's already a single word). Good.

Let me also double check the `createdAt` → `created_at`, `confirmedAt` → `confirmed_at` mappings. Prisma handles this automatically. Good.

Now WRITING:

Let me be extra careful with one thing in the test. The `anchorDocument` method uses `crypto.randomUUID()` which is available in Node 20+. ✓

Also, I need to handle: in the service, when I call `this.chainClient.prepare()`, what type am I passing? It takes `unknown` according to the interface. I'll pass `{ documentId, version, canonicalHash }`. ✓

OK, let me now actually type out every single file, completely. Here goes.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model DocumentVersion {
  id         String `@id @default(uuid())`
  documentId String
  version    String
  content    Json
  createdAt  DateTime @default(now())

  @@unique([documentId, version])
  @@map("document_versions")
}

model Anchor {
  id            String   @id @default(uuid())
  documentId    String
  version       String
  canonicalHash String
  txId          String
  signedTx      String
  state         AnchorState
  block         Int?
  createdAt     DateTime   @default(now())
  confirmedAt   DateTime?

  @@unique([documentId, version])
  @@map("anchors")
}

enum AnchorState {
  PREPARED
  BROADCAST_SENT
  BROADCAST_TIMEOUT
  CONFIRMED
  FAILED
}
```

### prisma/migrations/20240101000000_initial/migration.sql
```sql
CREATE TABLE "document_versions" (
  "id" VARCHAR(255) NOT NULL,
  "document_id" VARCHAR(255) NOT NULL,
  "version" VARCHAR(255) NOT NULL,
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_versions_document_id_version_unique"
  ON "document_versions" ("document_id", "version");

CREATE TYPE "anchor_state" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'BROADCAST_TIMEOUT', 'CONFIRMED', 'FAILED');

CREATE TABLE "anchors" (
  "id" VARCHAR(255) NOT NULL,
  "document_id" VARCHAR(255) NOT NULL,
  "version" VARCHAR(255) NOT NULL,
  "canonical_hash" VARCHAR(64) NOT NULL,
  "tx_id" VARCHAR(255) NOT NULL,
  "signed_tx" TEXT NOT NULL,
  "state" "anchor_state" NOT NULL DEFAULT 'PREPARED',
  "block" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "confirmed_at" TIMESTAMP,
  CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "anchors_document_id_version_unique"
  ON "anchors" ("document_id", "version");
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AnchorModule } from './anchor/anchor.module';

@Module({
  imports: [PrismaModule, AnchorModule],
})
export class AppModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/chain/chain.interface.ts
```ts
export interface ChainReceipt {
  txId: string;
  block: number;
  success: boolean;
}

export interface ChainClient {
  prepare(tx: unknown): { txId: string; signedTx: string };
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
```

### src/chain/chain.mock.ts
```ts
import { v4 as uuid } from 'uuid';
import type { ChainClient, ChainReceipt } from './chain.interface';

/**
 * Fake chain client for tests.
 *
 * - prepare() is local and deterministic within a test process: it generates a
 *   unique txId and a signedTx string, and records the input.
 * - broadcast() either succeeds immediately or throws (simulating a timeout),
 *   controlled via setBroadcastTimeout.
 * - getReceipt() looks up a receipt by txId from the chainReceipts map, which
 *   represents the L2 chain state and survives simulated process crashes.
 * - simulateCrash() clears in-memory tracking of which signed transactions have
 *   been broadcast (the state that was lost in the incident).
 */
export class MockChainClient implements ChainClient {
  private prepared = new Map<string, { txId: string; signedTx: string; input: unknown }>();
  private broadcasted = new Set<string>();
  private chainReceipts = new Map<string, ChainReceipt>();
  private broadcastTimeout = false;

  prepare(tx: unknown): { txId: string; signedTx: string } {
    const txId = uuid();
    const signedTx = `signed-${txId}`;
    this.prepared.set(txId, { txId, signedTx, input: tx });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.broadcastTimeout) {
      throw new Error('broadcast timed out');
    }
    this.broadcasted.add(signedTx);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.chainReceipts.get(txId) ?? null;
  }

  setBroadcastTimeout(value: boolean): void {
    this.broadcastTimeout = value;
  }

  setReceipt(txId: string, receipt: ChainReceipt): void {
    this.chainReceipts.set(txId, receipt);
  }

  getBroadcastedSignedTxs(): string[] {
    return [...this.broadcasted];
  }

  wasBroadcast(signedTx: string): boolean {
    return this.broadcasted.has(signedTx);
  }

  simulateCrash(): void {
    this.broadcasted.clear();
  }

  reset(): void {
    this.prepared.clear();
    this.broadcasted.clear();
    this.chainReceipts.clear();
    this.broadcastTimeout = false;
  }
}
```

### src/canonicalization/canonicalization.ts
```ts
import { createHash } from 'crypto';

/**
 * Canonicalization algorithm — written-down specification for auditors:
 *
 * 1. Recursively normalize the structured value:
 *    a. Objects: sort all keys alphabetically (UTF-8 code-point order, locale-independent).
 *       Recurse into each value.
 *    b. Arrays: preserve element order; normalize each element recursively.
 *    c. Strings: use as-is (UTF-8).
 *    d. Numbers: use the shortest decimal representation that round-trips
 *       (JSON.stringify in modern JS engines; no trailing zeros, no leading zeros
 *       before decimal, no scientific notation for |n| < 1e21).
 *    e. Booleans: lowercase ("true"/"false").
 *    f. Null: literal "null".
 *    g. undefined is rejected (not serializable).
 * 2. Serialize as compact JSON: no whitespace, minimal separators.
 * 3. UTF-8 encode the resulting string.
 * 4. Compute SHA-256 of the encoded bytes.
 * 5. Return lowercase hex digest.
 *
 * The PDF is a rendering of this structured content and is NOT used as the source of truth.
 * An auditor in four years reproduces this hash from the structured JSON alone.
 */
export function canonicalHash(value: unknown): string {
  const normalized = normalize(value);
  const bytes = JSON.stringify(normalized);
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  const type = typeof value;

  if (type === 'boolean') return value;
  if (type === 'string') return value;
  if (type === 'number') return normalizeNumber(value);
  if (type === 'undefined') throw new Error('Cannot canonicalize undefined');

  if (Array.isArray(value)) return value.map(normalize);

  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = normalize(obj[key]);
    }
    return sorted;
  }

  throw new Error(`Cannot canonicalize type: ${type}`);
}

function normalizeNumber(n: number): number {
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot canonicalize non-finite number: ${n}`);
  }
  return n;
}
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Anchor, DocumentVersion, Prisma } from '@prisma/client';

type AnchorState = Anchor['state'];

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createDocumentVersion(
    data: Prisma.DocumentVersionCreateInput & { documentId: string; version: string }
  ): Promise<DocumentVersion> {
    return this.prisma.documentVersion.create({
      data: {
        documentId: data.documentId,
        version: data.version,
        content: data.content as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findDocumentVersion(documentId: string, version: string): Promise<DocumentVersion | null> {
    return this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async createAnchorIntent(
    data: Prisma.AnchorCreateInput & { documentId: string; version: string }
  ): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        documentId: data.documentId,
        version: data.version,
        canonicalHash: data.canonicalHash as string,
        txId: data.txId as string,
        signedTx: data.signedTx as string,
        state: (data.state as AnchorState) ?? 'PREPARED',
      },
    });
  }

  async findByDocumentAndVersion(documentId: string, version: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { txId },
    });
  }

  async updateState(
    documentId: string,
    version: string,
    state: AnchorState,
    patch?: { block?: number; confirmedAt?: Date }
  ): Promise<Anchor> {
    const data: Prisma.AnchorUpdateInput = { state };
    if (patch) {
      if (patch.block !== undefined) data.block = patch.block;
      if (patch.confirmedAt !== undefined) data.confirmedAt = patch.confirmedAt;
    }
    return this.prisma.anchor.update({
      where: { documentId_version: { documentId, version } },
      data,
    });
  }

  async findAllAnchors(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany();
  }
}
```

### src/anchor/anchor.service.ts
```ts
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChainClient } from '../../chain/chain.interface';
import { canonicalHash } from '../../canonicalization/canonicalization';
import { AnchorRepository } from './anchor.repository';

export interface AnchorDocumentResult {
  anchorId: string;
  documentId: string;
  version: string;
  canonicalHash: string;
  txId: string;
  state: string;
}

export interface VerificationProof {
  match: true;
  txId: string;
  block: number;
}

export interface VerificationMismatch {
  match: false;
  storedHash?: string;
  computedHash: string;
}

export type VerificationResult = VerificationProof | VerificationMismatch;

@Injectable()
export class AnchorService {
  constructor(
    private readonly repository: AnchorRepository,
    private readonly chainClient: ChainClient,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Anchor a document version on L2.
   *
   * Order of operations (critical for compliance):
   * 1. Compute canonical hash of structured content.
   * 2. prepare() — obtain txId and signedTx (transaction identity exists now).
   * 3. Persist anchor intent with txId — COMMIT (recovery path has txId from here).
   * 4. Only then broadcast the signed transaction.
   */
  async anchorDocument(documentId: string, version: string): Promise<AnchorDocumentResult> {
    // Look up the structured content for this document version
    const docVersion = await this.repository.findDocumentVersion(documentId, version);
    if (!docVersion) {
      throw new HttpException(
        {
          error: {
            code: 'document_version_not_found',
            message: `No version ${version} found for document ${documentId}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // Schema-level uniqueness prevents duplicates, but check early for a clearer error
    const existing = await this.repository.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new HttpException(
        {
          error: {
            code: 'anchor_already_exists',
            message: `Anchor already exists for document ${documentId} version ${version}`,
            details: { anchorId: existing.id },
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    // Step 1: canonical hash of structured content (PDF is not the source of truth)
    const canonicalHash = canonicalHash(docVersion.content);

    // Step 2: prepare — obtain transaction identity (local, deterministic)
    const { txId, signedTx } = this.chainClient.prepare({ documentId, version, canonicalHash });

    // Step 3: persist anchor intent WITH tx identity, and commit
    // ASSUMPTION: Using $transaction for the persist to ensure atomicity with any subsequent checks.
    await this.prisma.$transaction(async (tx) => {
      // Double-check within transaction to guard against race conditions
      const already = await tx.anchor.findUnique({
        where: { documentId_version: { documentId, version } },
      });
      if (already) {
        throw new HttpException(
          {
            error: {
              code: 'anchor_already_exists',
              message: `Race condition: anchor was created concurrently for ${documentId} v${version}`,
              details: { anchorId: already.id },
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      await tx.anchor.create({
        data: {
          id: crypto.randomUUID(),
          documentId,
          version,
          canonicalHash,
          txId,
          signedTx,
          state: 'PREPARED',
        },
      });
    });

    // Step 4: broadcast (only after intent is durably persisted)
    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateState(documentId, version, 'BROADCAST_SENT');
    } catch {
      // Broadcast timed out or failed — outcome unknown. State moves to BROADCAST_TIMEOUT
      // so recovery sweep can resolve it later via getReceipt(txId).
      await this.repository.updateState(documentId, version, 'BROADCAST_TIMEOUT');
    }

    const anchor = await this.repository.findByDocumentAndVersion(documentId, version)!;

    return {
      anchorId: anchor.id,
      documentId: anchor.documentId,
      version: anchor.version,
      canonicalHash: anchor.canonicalHash,
      txId: anchor.txId,
      state: anchor.state,
    };
  }

  /**
   * Verify that content matches the anchored hash.
   * Returns either the anchoring proof (txId, block) or a mismatch report.
   */
  async verify(documentId: string, version: string, content: unknown): Promise<VerificationResult> {
    const anchor = await this.repository.findByDocumentAndVersion(documentId, version);
    const computedHash = canonicalHash(content);

    if (!anchor) {
      return { match: false, computedHash };
    }

    if (anchor.canonicalHash === computedHash) {
      return {
        match: true,
        txId: anchor.txId,
        block: anchor.block ?? 0,
      };
    }

    return {
      match: false,
      storedHash: anchor.canonicalHash,
      computedHash,
    };
  }
}
```

### src/anchor/anchor.worker.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import type { ChainClient } from '../../chain/chain.interface';
import { AnchorRepository } from './anchor.repository';

/**
 * Confirmation worker: polls receipts for anchors that have been broadcast
 * (BROADCAST_SENT, BROADCAST_TIMEOUT) or are still in PREPARED, and advances
 * their state based on chain receipts.
 *
 * Confirmation comes from getReceipt(), never from broadcast() returning.
 */
@Injectable()
export class AnchorWorker {
  private readonly logger = new Logger('AnchorWorker');

  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  async confirmPending(): Promise<number> {
    let confirmedCount = 0;
    const anchors = await this.repository.findAllAnchors();

    for (const anchor of anchors) {
      if (anchor.state === 'CONFIRMED' || anchor.state === 'FAILED') {
        continue;
      }

      // Ask the chain for the receipt
      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        const state = receipt.success ? 'CONFIRMED' : 'FAILED';
        await this.repository.updateState(anchor.documentId, anchor.version, state, {
          block: receipt.block,
          confirmedAt: new Date(),
        });
        confirmedCount++;
        this.logger.log(
          `Anchor ${anchor.documentId}/${anchor.version}: ${state} at block ${receipt.block}`,
        );
      }
    }

    return confirmedCount;
  }
}
```

### src/anchor/anchor.recovery.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import type { ChainClient } from '../../chain/chain.interface';
import { AnchorRepository } from './anchor.repository';

/**
 * Recovery sweep: resolves anchors stuck in broadcast limbo.
 *
 * For anchors in PREPARED or BROADCAST_TIMEOUT state:
 * 1. Query getReceipt(txId) BEFORE doing anything else.
 * 2. If the chain has a trace (receipt), confirm or fail the anchor.
 * 3. If the chain has no trace, re-broadcast the SAME signed transaction
 *    (not a new one — so a re-send cannot become a second anchor).
 */
@Injectable()
export class AnchorRecovery {
  private readonly logger = new Logger('AnchorRecovery');

  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  async recoverStuck(): Promise<number> {
    let recovered = 0;
    const anchors = await this.repository.findAllAnchors();

    for (const anchor of anchors) {
      if (anchor.state !== 'PREPARED' && anchor.state !== 'BROADCAST_TIMEOUT') {
        continue;
      }

      // Step 1: ask the chain first
      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        const state = receipt.success ? 'CONFIRMED' : 'FAILED';
        await this.repository.updateState(anchor.documentId, anchor.version, state, {
          block: receipt.block,
          confirmedAt: new Date(),
        });
        this.logger.log(
          `Recovery: anchor ${anchor.documentId}/${anchor.version} ${state} at block ${receipt.block}`,
        );
        recovered++;
        continue;
      }

      // Step 3: chain has no trace — re-broadcast the SAME signed transaction
      try {
        await this.chainClient.broadcast(anchor.signedTx);
        await this.repository.updateState(anchor.documentId, anchor.version, 'BROADCAST_SENT');
        this.logger.log(`Recovery: re-broadcast anchor ${anchor.documentId}/${anchor.version}`);
        recovered++;
      } catch {
        // Re-broadcast also timed out — leave in PREPARED/BROADCAST_TIMEOUT for next sweep
        this.logger.warn(
          `Recovery: re-broadcast timed out for ${anchor.documentId}/${anchor.version}`,
        );
      }
    }

    return recovered;
  }
}
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import type { ChainClient } from '../chain/chain.interface';
import { MockChainClient } from '../chain/chain.mock';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { AnchorWorker } from './anchor.worker';
import { AnchorRecovery } from './anchor.recovery';
import { AnchorController } from './anchor.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorWorker,
    AnchorRecovery,
    AnchorController,
    { provide: ChainClient, useClass: MockChainClient },
  ],
})
export class AnchorModule {}
```

### src/anchor/anchor.controller.ts
```ts
import { Controller, Post, Param, Body } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { AnchorWorker } from './anchor.worker';
import { AnchorRecovery } from './anchor.recovery';

@Controller('anchor')
export class AnchorController {
  constructor(
    private readonly anchorService: AnchorService,
    private readonly anchorWorker: AnchorWorker,
    private readonly anchorRecovery: AnchorRecovery,
  ) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchorDocument(@Param('documentId') documentId: string, @Param('version') version: string) {
    return this.anchorService.anchorDocument(documentId, version);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: unknown },
  ) {
    return this.anchorService.verify(documentId, version, body.content);
  }

  @Post('recovery-sweep')
  async recoverySweep() {
    const recovered = await this.anchorRecovery.recoverStuck();
    return { recovered };
  }

  @Post('confirm')
  async confirm() {
    const confirmed = await this.anchorWorker.confirmPending();
    return { confirmed };
  }
}
```

### test/canonicalization.spec.ts
```ts
import { canonicalHash } from '../src/canonicalization/canonicalization';

describe('canonicalHash', () => {
  test('deterministic: identical input produces identical hash', () => {
    const content = { patientId: 'abc', vitalSigns: { hr: 72, bp: '120/80' }, timestamp: '2024-01-01' };
    expect(canonicalHash(content)).toBe(canonicalHash(content));
  });

  test('key ordering: different key order produces same hash', () => {
    const a = { b: 1, a: 2, c: 3 };
    const b = { c: 3, a: 2, b: 1 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('nested key ordering: deep key sort', () => {
    const a = { z: { y: 1, x: 2 }, a: { c: 3, b: 4 } };
    const b = { a: { b: 4, c: 3 }, z: { x: 2, y: 1 } };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('whitespace: compact vs pretty-printed same hash', () => {
    // Same logical structure, different serialization in memory
    const obj: Record<string, unknown> = { name: 'test', values: [1, 2, 3] };
    obj.values = [1, 2, 3];
    const pretty = JSON.parse(JSON.stringify(obj, null, 2));
    expect(canonicalHash(obj)).toBe(canonicalHash(pretty));
  });

  test('number formatting: trailing zeros do not matter', () => {
    const a = { value: 72.0 };
    const b = { value: 72 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('array order is preserved', () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [3, 2, 1] };
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  test('null and boolean handling', () => {
    const a = { active: true, deleted: false, data: null };
    const b = { active: true, deleted: false, data: null };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('same logical document with different JSON key order produces same hash', () => {
    // Simulates the structured content vs a re-serialized version
    const content = {
      diagnosis: 'hypertension',
      patientId: 'P-001',
      encounter: {
        date: '2024-06-15',
        providerId: 'DOC-42',
      },
      medications: ['lisinopril', 'hctz'],
    };
    const reSerialized = {
      patientId: 'P-001',
      diagnosis: 'hypertension',
      encounter: { providerId: 'DOC-42', date: '2024-06-15' },
      medications: ['lisinopril', 'hctz'],
    };
    expect(canonicalHash(content)).toBe(canonicalHash(reSerialized));
  });
});
```

### test/anchor.spec.ts
```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import type { ChainClient, ChainReceipt } from '../src/chain/chain.interface';
import { MockChainClient } from '../src/chain/chain.mock';
import { AnchorModule } from '../src/anchor/anchor.module';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorRepository } from '../src/anchor/anchor.repository';
import { AnchorWorker } from '../src/anchor/anchor.worker';
import { AnchorRecovery } from '../src/anchor/anchor.recovery';
import type { Anchor } from '@prisma/client';

describe('Anchor (Variant A — Regulated report anchoring)', () => {
  let anchorService: AnchorService;
  let anchorRepository: AnchorRepository;
  let anchorWorker: AnchorWorker;
  let anchorRecovery: AnchorRecovery;
  let mockChain: MockChainClient;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AnchorModule],
    }).compile();

    anchorService = module.get<AnchorService>(AnchorService);
    anchorRepository = module.get<AnchorRepository>(AnchorRepository);
    anchorWorker = module.get<AnchorWorker>(AnchorWorker);
    anchorRecovery = module.get<AnchorRecovery>(AnchorRecovery);
    mockChain = module.get<ChainClient>(ChainClient) as unknown as MockChainClient;
    prisma = module.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    mockChain.reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Helper: create a document version ─────────────────────────────
  const createDocVersion = async (documentId: string, version: string, content: unknown) => {
    return prisma.documentVersion.create({
      data: {
        id: crypto.randomUUID(),
        documentId,
        version,
        content: content as unknown as import('prisma').InputJsonValue,
      },
    });
  };

  // ════════════════════════════════════════════════════════════════════
  // Acceptance: Intent with tx identity is committed before broadcast
  // ════════════════════════════════════════════════════════════════════
  describe('anchorDocument', () => {
    test('persists anchor intent with txId before broadcast', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001', diagnosis: 'flu' });

      let broadcastWasCalled = false;
      const originalBroadcast = mockChain.broadcast.bind(mockChain);
      mockChain.broadcast = async (signedTx: string) => {
        broadcastWasCalled = true;
        // Check DB state mid-broadcast
        const anchorInDb = await prisma.anchor.findUnique({ where: { txId: null as unknown as string } }).catch(() => null);
        // Instead, directly verify via repository
        const repoAnchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
        expect(repoAnchor).not.toBeNull();
        expect(repoAnchor!.state).toBe('PREPARED');
        expect(repoAnchor!.txId.length).toBeGreaterThan(0);
        await originalBroadcast(signedTx);
      };

      await anchorService.anchorDocument('doc-1', 'v1');

      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(anchor).not.toBeNull();
      expect(anchor!.state).toBe('BROADCAST_SENT');
      expect(anchor!.txId.length).toBeGreaterThan(0);
      expect(anchor!.signedTx.length).toBeGreaterThan(0);
      expect(broadcastWasCalled).toBe(true);
    });

    test('rejects duplicate anchor for same (document, version)', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });

      await anchorService.anchorDocument('doc-1', 'v1');

      await expect(anchorService.anchorDocument('doc-1', 'v1')).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining('anchor already exists') }),
      );

      // Schema-level: exactly one anchor in DB
      const all = await anchorRepository.findAllAnchors();
      expect(all).toHaveLength(1);
    });

    test('throws when document version not found', async () => {
      await expect(anchorService.anchorDocument('doc-99', 'v1')).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining('No version') }),
      );
    });

    test('broadcast success → state BROADCAST_SENT', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });

      const result = await anchorService.anchorDocument('doc-1', 'v1');

      expect(result.state).toBe('BROADCAST_SENT');
      expect(mockChain.getBroadcastedSignedTxs()).toHaveLength(1);
    });

    test('broadcast timeout → state BROADCAST_TIMEOUT', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });
      mockChain.setBroadcastTimeout(true);

      const result = await anchorService.anchorDocument('doc-1', 'v1');

      expect(result.state).toBe('BROADCAST_TIMEOUT');
      expect(mockChain.getBroadcastedSignedTxs()).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Acceptance: Broadcast times out but landed → recovery confirms from receipt
  // ════════════════════════════════════════════════════════════════════
  describe('recovery sweep', () => {
    test('broadcast timeout but landed → recovery confirms from receipt, no re-broadcast', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });
      mockChain.setBroadcastTimeout(true);

      const result = await anchorService.anchorDocument('doc-1', 'v1');
      const txId = result.txId;

      // Chain actually has the transaction (it landed despite timeout)
      const receipt: ChainReceipt = { txId, block: 42, success: true };
      mockChain.setReceipt(txId, receipt);

      // Recovery sweep should confirm without re-broadcasting
      await anchorRecovery.recoverStuck();

      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(anchor).not.toBeNull();
      expect(anchor!.state).toBe('CONFIRMED');
      expect(anchor!.block).toBe(42);
      expect(mockChain.wasBroadcast(anchor!.signedTx)).toBe(false);
    });

    test('broadcast timeout and did not land → re-broadcast same signedTx, one anchor', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });
      mockChain.setBroadcastTimeout(true);

      await anchorService.anchorDocument('doc-1', 'v1');

      const anchorBefore = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(anchorBefore!.state).toBe('BROADCAST_TIMEOUT');

      // Chain has no trace of this transaction
      // (no receipt set for anchorBefore.txId)

      // Recovery sweep should re-broadcast the same signed transaction
      await anchorRecovery.recoverStuck();

      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(anchor!.state).toBe('BROADCAST_SENT');
      expect(mockChain.wasBroadcast(anchor!.signedTx)).toBe(true);
      expect(mockChain.getBroadcastedSignedTxs()).toHaveLength(1);
      expect(anchor!.signedTx).toBe(anchorBefore!.signedTx);
    });

    test('crash between broadcast and confirmation → restart recovers, one anchor total', async () => {
      // Setup: broadcast will timeout
      mockChain.setBroadcastTimeout(true);
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });

      // Perform anchoring: persists PREPARED → broadcast fails → BROADCAST_TIMEOUT
      await anchorService.anchorDocument('doc-1', 'v1');

      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(anchor).not.toBeNull();
      const txId = anchor!.txId;
      const signedTx = anchor!.signedTx;
      expect(anchor!.state).toBe('BROADCAST_TIMEOUT');

      // Simulate process crash: lose all in-memory broadcast tracking
      mockChain.simulateCrash();

      // Simulate restart: fresh chain client, but chain has the receipt
      mockChain.reset();
      mockChain.setReceipt(txId, { txId, block: 12345, success: true });

      // Run recovery sweep (simulating post-restart recovery path)
      await anchorRecovery.recoverStuck();

      // Verify: exactly one anchor total, confirmed
      const allAnchors = await anchorRepository.findAllAnchors();
      expect(allAnchors).toHaveLength(1);
      expect(allAnchors[0].state).toBe('CONFIRMED');
      expect(allAnchors[0].block).toBe(12345);
      expect(allAnchors[0].txId).toBe(txId);
    });

    test('crash: recovery sweep re-broadcasts same tx when chain has no trace', async () => {
      mockChain.setBroadcastTimeout(true);
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });

      await anchorService.anchorDocument('doc-1', 'v1');
      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(anchor!.state).toBe('BROADCAST_TIMEOUT');

      // Simulate crash and restart without the receipt
      mockChain.simulateCrash();
      mockChain.reset();
      // No receipt set — chain truly has no trace

      await anchorRecovery.recoverStuck();

      const allAnchors = await anchorRepository.findAllAnchors();
      expect(allAnchors).toHaveLength(1);
      expect(allAnchors[0].state).toBe('BROADCAST_SENT');
      // Same signed transaction was re-broadcast
      expect(mockChain.wasBroadcast(allAnchors[0].signedTx)).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Acceptance: Confirmation worker polling receipts
  // ════════════════════════════════════════════════════════════════════
  describe('confirmation worker', () => {
    test('confirms BROADCAST_SENT anchor when receipt arrives', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });

      const result = await anchorService.anchorDocument('doc-1', 'v1');
      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');

      // Worker should find no receipt yet
      const confirmed = await anchorWorker.confirmPending();
      expect(confirmed).toBe(0);
      expect(anchor!.state).toBe('BROADCAST_SENT');

      // Receipt lands on chain
      mockChain.setReceipt(result.txId, { txId: result.txId, block: 99, success: true });

      // Worker confirms
      const confirmed2 = await anchorWorker.confirmPending();
      expect(confirmed2).toBe(1);

      const updated = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(updated!.state).toBe('CONFIRMED');
      expect(updated!.block).toBe(99);
    });

    test('marks FAILED when receipt says success: false', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001' });
      await anchorService.anchorDocument('doc-1', 'v1');

      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      mockChain.setReceipt(anchor!.txId, { txId: anchor!.txId, block: 5, success: false });

      await anchorWorker.confirmPending();

      const updated = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      expect(updated!.state).toBe('FAILED');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Acceptance: verify returns proof or mismatch
  // ════════════════════════════════════════════════════════════════════
  describe('verify', () => {
    test('matching content returns anchoring proof with txId and block', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001', diagnosis: 'asthma' });
      mockChain.setBroadcastTimeout(true);

      await anchorService.anchorDocument('doc-1', 'v1');

      // Simulate confirmation
      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');
      mockChain.setReceipt(anchor!.txId, { txId: anchor!.txId, block: 777, success: true });
      await anchorWorker.confirmPending();

      const result = await anchorService.verify('doc-1', 'v1', { patientId: 'P-001', diagnosis: 'asthma' });
      expect(result.match).toBe(true);
      expect((result as { txId: string; block: number }).txId).toBe(anchor!.txId);
      expect((result as { txId: string; block: number }).block).toBe(777);
    });

    test('mismatching content returns mismatch report', async () => {
      await createDocVersion('doc-1', 'v1', { patientId: 'P-001', diagnosis: 'asthma' });
      mockChain.setBroadcastTimeout(true);

      await anchorService.anchorDocument('doc-1', 'v1');
      const anchor = await anchorRepository.findByDocumentAndVersion('doc-1', 'v1');

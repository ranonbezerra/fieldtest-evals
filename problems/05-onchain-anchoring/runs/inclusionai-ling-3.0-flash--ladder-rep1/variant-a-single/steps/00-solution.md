# solution

## reasoning

```
Let me carefully analyze this task. I need to build a document anchoring system for a healthtech platform that anchors clinical/administrative reports on an L2 chain. Let me break down the requirements:

1. **`anchorDocument(documentId, version)`** - computes canonical hash, persists anchor intent with tx identity BEFORE broadcasting, then broadcasts
2. **Confirmation worker** polling receipts and advancing state
3. **Recovery sweep** that resolves anchors stuck in broadcast-limbo
4. **`verify(documentId, version, content)`** - recomputes hash, returns anchoring proof or mismatch
5. **Exactly one anchor per (document, version)** - schema-level enforcement

Key architectural decisions:
- The tx identity must be persisted BEFORE broadcast (the core bug fix from L2-spec)
- States: prepared, broadcast-sent, broadcast-limbo (timeout), confirmed, failed
- Recovery: query getReceipt first, only re-broadcast if chain has no trace
- Unique constraint at schema level on (documentId, version)
- Canonicalization of JSON: sorted keys, normalized numbers, no whitespace, UTF-8 encode, SHA-256

Let me design the schema, modules, services, repositories, controllers, workers, and tests.

**Prisma Schema:**
- `Anchor` model with: id, documentId, version, contentHash, txId, signedTx, status (enum), block, createdAt, updatedAt
- Unique constraint on (documentId, version)
- Status enum: PREPARED, BROADCAST_SENT, BROADCAST_LIMBO, CONFIRMED, FAILED

**Modules:**
- `anchor` module (main feature)
  - anchor controller
  - anchor service
  - anchor repository
  - confirmation worker (part of anchor module or separate)
  - recovery sweep (part of anchor module or separate)
  - chain client interface + fake

Let me think about the canonicalization:
1. Parse JSON
2. Recursively sort object keys alphabetically
3. Normalize numbers (strip trailing zeros, use standard representation)
4. Remove all whitespace
5. UTF-8 encode
6. SHA-256 hash

Now let me think about the file layout:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/anchor/anchor.module.ts
src/anchor/anchor.controller.ts
src/anchor/anchor.service.ts
src/anchor/anchor.repository.ts
src/anchor/anchor.types.ts
src/anchor/confirmation-worker.ts
src/anchor/recovery-sweep.ts
src/chain/chain-client.interface.ts
src/chain/fake-chain.client.ts
src/anchor/anchor.spec.ts
```

Let me think about the status flow:
1. `anchorDocument` is called:
   a. Compute hash
   b. Call `prepare()` → {txId, signedTx}
   c. Persist anchor intent with txId, status = PREPARED → wait, actually it should go straight to BROADCAST_SENT or... let me re-read.

Actually, the states should be:
- PREPARED: anchor intent created with txId, before broadcast
- BROADCAST_SENT: broadcast was called and returned successfully
- BROADCAST_LIMBO: broadcast timed out, outcome unknown
- CONFIRMED: receipt confirms it's on chain
- FAILED: confirmed to have failed

Wait, re-reading the spec: "At minimum: prepared, broadcast-sent, confirmed, failed. And a state for broadcast attempted, outcome unknown — the timeout case."

So:
1. anchorDocument computes hash, prepare, persist (status = PREPARED), then broadcast
2. If broadcast succeeds → BROADCAST_SENT
3. If broadcast times out → BROADCAST_LIMBO
4. Worker polls receipts: if confirmed → CONFIRMED, if not → stays as is
5. Recovery sweep: for BROADCAST_LIMBO, query getReceipt. If found → CONFIRMED. If not → re-broadcast same signed tx, then... 

Actually let me reconsider the flow more carefully. The key insight is:
- Persist BEFORE broadcast (so even if broadcast times out, we have the txId)
- After persist, broadcast
- If broadcast returns OK → BROADCAST_SENT
- If broadcast times out → BROADCAST_LIMBO (we already have the txId persisted)
- Worker polls: for BROADCAST_SENT and BROADCAST_LIMBO, check receipts
  - If receipt found → CONFIRMED
  - If not found → stays in current state (or could mark as needing retry)
- Recovery sweep for BROADCAST_LIMBO specifically:
  - Query getReceipt(txId) first
  - If found → CONFIRMED
  - If not found → re-broadcast the SAME signedTx

Now let me think about the crash scenario test: "crashes the process between broadcast and the point where a naive design would persist" - the naive design would persist after broadcast. Our design persists BEFORE broadcast. So when we crash between broadcast and confirmation (which is what the worker handles), and restart, the recovery sweep finds the anchor in PREPARED or BROADCAST_SENT/LIMBO state and resolves it.

Wait, let me re-read: "Prove it with a test that crashes the process between the broadcast and the point where a naive design would persist, then restarts and recovers."

The naive design persists AFTER broadcast. So between broadcast returning and the persist happening, a crash would mean we lose the anchor. In our design, we persist BEFORE broadcast, so after restart the anchor is already there. The test should show:
1. Start anchoring (which persists before broadcasting)
2. Broadcast happens (or is attempted)
3. Process crashes before confirmation
4. On restart, recovery sweep runs
5. Exactly one anchor exists with exactly one txId

Let me design the test carefully.

Now, let me think about what `verify` needs:
- Take documentId, version, content
- Compute hash from content
- Look up anchor by (documentId, version)
- Compare hashes
- If match: return {txId, block}
- If mismatch: return {mismatch: true, expectedHash, actualHash, ...}

Let me now write all the files.

For the chain client interface:
```ts
interface ChainClient {
  prepare(tx: unknown): { txId: string; signedTx: string };
  broadcast(signedTx: string): Promise<void>; // may timeout
  getReceipt(txId: string): Promise<Receipt | null>;
}

interface Receipt {
  txId: string;
  block: number;
  status: 'confirmed' | 'failed';
}
```

Let me think about the Prisma schema carefully. I need:
- An anchor table with unique constraint on (documentId, version)
- Status enum

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Anchor {
  id          String   @id @default(uuid())
  documentId  String
  version     String
  contentHash String
  txId        String
  signedTx    String
  status      String   @default("PREPARED")
  block       Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([documentId, version])
  @@map("anchors")
}
```

Now let me think about the service methods and their error handling.

For errors, the envelope is:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

Relevant error codes:
- `anchor_not_found` - when verify can't find an anchor
- `anchor_conflict` - when trying to anchor the same (document, version) twice
- `content_mismatch` - when verify finds hash mismatch

Let me now plan all files systematically:

1. **prisma/schema.prisma** - Anchor model with unique constraint
2. **src/chain/chain-client.interface.ts** - ChainClient interface
3. **src/chain/fake-chain-client.ts** - Fake implementation for tests
4. **src/anchor/anchor.types.ts** - Types and enums
5. **src/anchor/anchor.repository.ts** - Database operations
6. **src/anchor/anchor.service.ts** - Business logic
7. **src/anchor/anchor.controller.ts** - HTTP endpoints
8. **src/anchor/confirmation-worker.ts** - Worker for polling receipts
9. **src/anchor/recovery-sweep.ts** - Recovery sweep for limbo anchors
10. **src/anchor/anchor.module.ts** - Module wiring
11. **src/app.module.ts** - Root module
12. **src/main.ts** - Entry point
13. **test/anchor.spec.ts** - Tests

Wait, should tests go in test/ or src/anchor/? The convention says `test/<feature>.spec.ts`.

Let me reconsider the canonicalization. The spec says:
- Key ordering: sorted recursively
- Number formatting: normalized
- Whitespace: stripped
- Encoding: UTF-8
- Hash: SHA-256

For the canonicalization function:
1. Sort object keys recursively
2. For numbers, use `JSON.stringify` which already handles this reasonably (or strip trailing zeros)
3. Stringify with no whitespace: `JSON.stringify(sorted)`
4. No whitespace between items (already no whitespace in compact JSON)
5. UTF-8 encode
6. SHA-256

Actually, the simplest canonicalization:
1. Recursively sort keys
2. `JSON.stringify(obj, null, 0)` - no whitespace
3. UTF-8 bytes
4. SHA-256

That should be sufficient and well-defined.

Now let me think about the worker and sweep as part of the system. They need to run periodically. In NestJS, I can use `@nestjs/scheudler` or just implement them as services that can be called manually (for testing). For simplicity in this context, I'll make them injectable services with methods that can be called on demand or scheduled.

Actually, let me keep it simpler - make them services with `run()` methods. Tests can call them directly.

Let me now write all the code.

One important consideration: the "crash between broadcast and confirmation" test. In our design, the anchor is persisted BEFORE broadcast. So if we:
1. Call anchorDocument → it persists PREPARED, then broadcasts
2. Crash here (before worker confirms)
3. Restart → run recovery sweep
4. Recovery sweep queries getReceipt(txId)
5. In fake chain client, if the tx was "accepted", getReceipt returns it
6. Anchor becomes CONFIRMED
7. Test asserts: exactly one anchor, exactly one txId

But also need to test: "Broadcast times out and did not land → same signed tx re-broadcast, one anchor"
- anchorDocument persists PREPARED, broadcast times out → BROADCAST_LIMBO
- Recovery sweep: getReceipt returns null → re-broadcast same signedTx → BROADCAST_SENT
- Should still be exactly one anchor

And: "Broadcast times out but landed → recovery confirms from receipt, no re-broadcast"
- anchorDocument persists PREPARED, broadcast times out → BROADCAST_LIMBO
- Recovery sweep: getReceipt returns receipt → CONFIRMED
- No re-broadcast

And: "Anchoring the same (document, version) twice → rejected by the database"
- First anchorDocument succeeds
- Second anchorDocument for same (documentId, version) → unique constraint violation → error

Let me design the fake chain client carefully. It needs to simulate:
- prepare: deterministic, returns txId and signedTx
- broadcast: sometimes succeeds, sometimes times out
- getReceipt: returns receipt for "accepted" transactions, null otherwise

I'll make it configurable in tests.

Let me now write all files. I'll be thorough.

For the controller, endpoints should be:
- POST /anchor/:documentId/version/:version - anchorDocument
- GET /anchor/:documentId/version/:version/verify - verify
- GET /anchor/:documentId/version/:version - get anchor status

Actually, let me re-read the spec for endpoints... The spec doesn't specify exact endpoints, just the functions. Let me use sensible REST-style endpoints.

Let me write this all out now.

One more thought on the signedTx re-broadcast constraint: "the same one, not a new one, so a re-send cannot become a second anchor." This means when we re-broadcast in recovery, we must use the same signedTx and same txId that were originally prepared. This is naturally handled because we persist the txId and signedTx, and the recovery sweep reads them from the persisted anchor.

Now, regarding `verify` - it takes content as a parameter, recomputes the hash, and compares. So:
- If content matches stored hash → return {txId, block}
- If content doesn't match → return mismatch report

Let me finalize and write everything.

Actually, I realize I should think about what `anchorDocument` does step by step:

```typescript
async anchorDocument(documentId: string, version: string, content: Record<string, unknown>) {
  // 1. Compute canonical hash
  const contentHash = canonicalHash(content);
  
  // 2. Prepare transaction
  const { txId, signedTx } = this.chainClient.prepare({ documentId, version, contentHash });
  
  // 3. Persist anchor intent (BEFORE broadcast)
  const anchor = await this.repository.create({
    documentId,
    version,
    contentHash,
    txId,
    signedTx,
    status: 'PREPARED',
  });
  
  // 4. Broadcast
  try {
    await this.chainClient.broadcast(signedTx);
    await this.repository.updateStatus(anchor.id, 'BROADCAST_SENT');
  } catch (error) {
    // Timeout or error - mark as limbo
    await this.repository.updateStatus(anchor.id, 'BROADCAST_LIMBO');
  }
  
  return anchor;
}
```

Wait, but step 3 should "commit" before step 4. With Prisma, that means the create transaction is committed before broadcast is called. Since Prisma operations are auto-committed, that's naturally the case.

Now let me think about the confirmation worker. It should:
1. Find anchors in BROADCAST_SENT or BROADCAST_LIMBO status
2. For each, call getReceipt(txId)
3. If receipt found and confirmed → update to CONFIRMED, set block
4. If receipt found but failed → update to FAILED
5. If no receipt found → leave as is (or for BROADCAST_SENT, could mark as needing retry)

Recovery sweep for limbo:
1. Find anchors in BROADCAST_LIMBO status
2. For each, call getReceipt(txId) FIRST
3. If receipt found → confirm it
4. If no receipt → re-broadcast the same signedTx, then update to BROADCAST_SENT

Now let me think about the unique constraint test. The test needs to:
1. Create an anchor for (doc1, v1) → succeeds
2. Try to create another anchor for (doc1, v1) → should fail with unique constraint error
3. In Prisma, this throws a PrismaException with code "P2002"

Let me also think about what happens if the persist succeeds but broadcast fails, and then we try to anchor again. Since we have a unique constraint, the second call would fail. But is that correct behavior? Actually yes - "Exactly one anchor per (document, version), enforced at the schema level."

But wait, what about the recovery case where we need to re-broadcast? The anchor already exists, so we just update its status and call broadcast again with the same signedTx.

OK, I think I have a complete picture now. Let me write all the code.

Let me also think about imports and NestJS patterns:
- `@Injectable()` for services
- `@Controller()` for controllers
- `@Module()` for modules
- `@nestjs/common` for exceptions, pipes, etc.
- `@nestjs/scheduling` if I use定时 workers, but I'll keep workers as manual-trigger services for testability

Actually, let me use `@nestjs/scheduling` with `@Interval` or `@Cron` for the worker. But for testing, it's easier to just have a `run()` method. I'll provide both - a scheduled method and a manual run method.

Hmm, but the spec says "A confirmation worker polling receipts and advancing state". So it needs to poll periodically. Let me use `@nestjs/scheduling` with a polling interval. But I'll also make it callable directly for tests.

Let me not over-complicate this. I'll make the worker a service with a `run()` method that can be called on a schedule or manually. Tests will call it directly.

Let me now write all files.

For the Prisma types, I need to be careful. After `npx prisma generate`, the types are generated. In the repository, I'll use `Prisma.Anchor` types.

Let me also think about error handling in the controller. The service should throw custom exceptions, and the controller should let them propagate (or use an exception filter). Actually, the convention says errors use the envelope format. I should create an exception filter or use `@nestjs/common` exceptions with the right format.

Actually, let me use a custom exception filter that formats all errors into the envelope. Or I can have the service throw `HttpException` with the right structure. Let me create a simple approach.

For the service, I'll define custom errors and use an exception filter at the controller level or globally. Let me keep it simple: the service throws errors with the right shape, and I'll add an exception filter.

Actually, let me define the error format clearly. The spec says:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

I'll create an `AnchorException` class or use NestJS `HttpException` with a custom response.

Let me finalize my approach:

```typescript
// In service
throw new HttpException(
  { error: { code: 'anchor_conflict', message: '...', details: {} } },
  409
);
```

Or better, create an exception filter. Let me use a dedicated exception filter for clean code.

Actually, to keep it simple and testable, I'll just have the service return Result types or throw standard errors, and the controller will format them. But that's more work.

Let me just use a simple approach: a `throwError` helper that creates the right HttpException.

OK let me just write all the code now. I've thought about this enough.

One more thing: the signedTx type. It's described as a string (something you'd broadcast to a chain). The prepare function returns `{txId, signedTx}`. So signedTx is a string.

Also, let me think about what content looks like. "Structured JSON rendered to PDF." So content is a JSON object. For the `anchorDocument` API, I'll accept it as a JSON body. For `verify`, I'll accept it as a JSON body too.

Let me now structure the final code:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/chain/chain-client.interface.ts
src/chain/fake-chain-client.ts
src/anchor/anchor.types.ts
src/anchor/anchor.module.ts
src/anchor/anchor.controller.ts
src/anchor/anchor.service.ts
src/anchor/anchor.repository.ts
src/anchor/confirmation-worker.ts
src/anchor/recovery-sweep.ts
test/anchor.spec.ts
```

I think this covers everything. Let me write it all now.

Let me reconsider one thing about the test. The spec says: "Prove it with a test that crashes the process between broadcast and the (wrong) late persist a naive design would do."

This means: simulate a crash after broadcast but before confirmation. In our design, the persist happens BEFORE broadcast, so after restart, the anchor is still there. The test should:
1. Call anchorDocument (which persists before broadcasting)
2. The broadcast happens (let's say it times out, so status = BROADCAST_LIMBO)
3. "Crash" - just stop here, don't run the worker
4. "Restart" - run recovery sweep
5. Assert: exactly one anchor exists, with the original txId
6. If the chain has no trace, recovery re-broadcasts → still exactly one anchor

This proves our design works because we never lost the anchor.

For a "naive" design that persists after broadcast:
1. Call anchorDocument - broadcast succeeds
2. Process crashes before persist
3. Anchor is lost! On restart, no anchor exists.
4. On chain, the tx exists but DB doesn't know about it.

So our test shows the advantage of our approach.

Let me now write all the code. I'll make it comprehensive.

One more detail: for the fake chain client, I need it to support different scenarios:
- Normal: broadcast succeeds, getReceipt works
- Timeout: broadcast throws (timeout), getReceipt may or may not have the tx
- Lost: broadcast times out, getReceipt returns null (tx didn't land)

I'll make the fake chain client configurable with a map of txId → receipt status.

Let me also think about what `getReceipt` returns. From the L2 spec: `getReceipt(txId)`. The receipt should contain at minimum: txId, block number, and confirmation status.

```typescript
interface ChainReceipt {
  txId: string;
  block: number;
  status: 'confirmed' | 'failed';
}
```

Now writing the code:

For the canonicalization, I need to be very precise:

```typescript
function canonicalize(obj: unknown): string {
  // 1. Recursively sort object keys
  const sorted = sortKeys(obj);
  // 2. Compact JSON (no whitespace)
  return JSON.stringify(sorted);
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

async function canonicalHash(content: Record<string, unknown>): Promise<string> {
  const canonical = canonicalize(content);
  const buffer = Buffer.from(canonical, 'utf-8');
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}
```

This is clean, deterministic, and well-defined for an auditor to reproduce.

Now let me finalize everything and write the complete solution.

I realize I should think more carefully about the anchor status transitions and what the "prepared" state means. Looking at the L2 spec again:

"At minimum: prepared, broadcast-sent, confirmed, failed. And a state for broadcast attempted, outcome unknown — the timeout case."

So:
- PREPARED: anchor intent created, txId persisted, not yet broadcast
- BROADCAST_SENT: broadcast succeeded (returned without error)
- BROADCAST_LIMBO: broadcast attempted but timed out (outcome unknown)
- CONFIRMED: receipt confirms on chain
- FAILED: receipt confirms failure on chain

Wait, but looking at my anchorDocument flow:
1. Compute hash
2. prepare() → {txId, signedTx}
3. Persist (status = PREPARED)
4. broadcast()
   - If success → BROADCAST_SENT
   - If timeout → BROADCAST_LIMBO

The spec says "persist the anchor intent, including the tx identity, and commit" then "only then broadcast". So status at persist is PREPARED, then broadcast changes it.

Hmm, but actually maybe PREPARED isn't needed as a persistent state - it exists only momentarily within the anchorDocument call. After broadcast, it's either BROADCAST_SENT or BROADCAST_LIMBO. But since the process could crash between persist and broadcast, we need PREPARED as a persistent state too. That way, the recovery sweep can handle PREPARED anchors (which were persisted but never broadcast).

Actually, let me reconsider. The flow is:
1. Compute hash
2. prepare()
3. Persist (status = PREPARED)
4. broadcast()

If crash between 3 and 4: anchor is PREPARED, never broadcast. Recovery should handle this - it should broadcast the same signedTx.

So PREPARED is a valid state for the recovery sweep to handle.

Let me update the recovery sweep:
- For PREPARED: broadcast the same signedTx, then mark as BROADCAST_SENT or BROADCAST_LIMBO
- For BROADCAST_LIMBO: getReceipt first. If found → CONFIRMED. If not → re-broadcast.
- For BROADCAST_SENT: getReceipt. If found → CONFIRMED. If not → leave as is (or handle differently)

Wait, but the spec says for limbo: "query getReceipt(txId) before doing anything else. If it landed, confirm it. Only if the chain has no trace may the same signed transaction be re-broadcast."

And for PREPARED (never broadcast): we should just broadcast it. But what about getReceipt? The spec doesn't specifically say. I think for PREPARED, we should also check getReceipt first (in case it somehow landed), and if not, broadcast it.

Let me simplify: the recovery sweep handles all non-confirmed, non-failed states:
- PREPARED: check receipt. If found → CONFIRMED. If not → broadcast.
- BROADCAST_SENT: check receipt. If found → CONFIRMED. If not → leave as is.
- BROADCAST_LIMBO: check receipt. If found → CONFIRMED. If not → re-broadcast.

Hmm but the spec specifically says the recovery sweep is for "anchors stuck in broadcast-limbo." Let me keep PREPARED handling in the worker or in anchorDocument itself.

Actually, let me have two separate things:
1. **Confirmation worker**: polls BROADCAST_SENT and BROADCAST_LIMBO anchors, checks receipts
2. **Recovery sweep**: specifically for BROADCAST_LIMBO, queries chain first then re-broadcasts if needed

And for PREPARED anchors (crash between persist and broadcast), I'll handle them in the recovery sweep too, or as part of the worker.

Actually, let me just include PREPARED in the recovery sweep. The recovery sweep handles all "stuck" anchors:

```typescript
async run(): Promise<void> {
  // Find all stuck anchors: PREPARED, BROADCAST_SENT, BROADCAST_LIMBO
  const stuckAnchors = await this.repository.findStuck();
  
  for (const anchor of stuckAnchors) {
    // Always check chain first
    const receipt = await this.chainClient.getReceipt(anchor.txId);
    
    if (receipt) {
      // Chain has it - confirm
      await this.repository.confirm(anchor.id, receipt.block, receipt.status);
      continue;
    }
    
    // Chain has no trace
    if (anchor.status === 'PREPARED' || anchor.status === 'BROADCAST_LIMBO') {
      // Re-broadcast the same signed tx
      try {
        await this.chainClient.broadcast(anchor.signedTx);
        await this.repository.updateStatus(anchor.id, 'BROADCAST_SENT');
      } catch {
        await this.repository.updateStatus(anchor.id, 'BROADCAST_LIMBO');
      }
    }
    // BROADCAST_SENT with no receipt yet - leave alone
  }
}
```

Wait, but the spec distinguishes between the confirmation worker and the recovery sweep. Let me keep them separate:

**Confirmation worker**: polls receipts for BROADCAST_SENT and BROADCAST_LIMBO, advances to CONFIRMED/FAILED
**Recovery sweep**: specifically for BROADCAST_LIMBO, queries chain first, then re-broadcasts if needed

And PREPARED anchors (crash before broadcast) - these would be handled by... hmm. Let me think.

The spec says: "A recovery sweep that resolves anchors stuck in broadcast-limbo by querying the chain first."

So the recovery sweep is specifically for BROADCAST_LIMBO. But PREPARED anchors (crash before broadcast) are also a problem. Let me handle them in the recovery sweep too, as a broader recovery mechanism. Or maybe I should call them "stuck" and have the recovery sweep handle all non-final states.

Actually, let me re-read: "Crashes the process between broadcast and the (wrong) late persist a naive design would do."

In our design, anchor is persisted BEFORE broadcast. So crash between persist and broadcast → PREPARED state. Crash between broadcast and confirmation → BROADCAST_SENT or BROADCAST_LIMBO state. Both are recoverable.

Let me make the recovery sweep handle all stuck states (PREPARED, BROADCAST_SENT, BROADCAST_LIMBO), and the confirmation worker specifically polls for receipt confirmation.

Let me separate concerns:

**Confirmation worker** (`ConfirmationWorker`):
- Scheduled task that runs periodically
- Finds anchors in BROADCAST_SENT or BROADCAST_LIMBO
- For each, calls getReceipt(txId)
- If confirmed → CONFIRMED, set block
- If failed → FAILED
- If no receipt → no change (they'll be picked up next time or by recovery)

**Recovery sweep** (`RecoverySweep`):
- Can be manual or scheduled
- Finds anchors in PREPARED, BROADCAST_LIMBO (stuck states where action is needed)
- For each:
  - Query getReceipt(txId) FIRST
  - If found → update to CONFIRMED
  - If not found:
    - PREPARED → broadcast (new attempt), update to BROADCAST_SENT or BROADCAST_LIMBO
    - BROADCAST_LIMBO → re-broadcast same signedTx, update to BROADCAST_SENT or BROADCAST_LIMBO

This makes sense. Now let me code it.

Let me finalize the status enum and transitions:

```
PREPARED → BROADCAST_SENT (broadcast success)
PREPARED → BROADCAST_LIMBO (broadcast timeout)  [if crash between persist and broadcast]
BROADCAST_SENT → CONFIRMED (receipt confirms)
BROADCAST_SENT → FAILED (receipt shows failure)
BROADCAST_LIMBO → CONFIRMED (receipt confirms via recovery)
BROADCAST_LIMBO → BROADCAST_SENT (re-broadcast in recovery)
BROADCAST_LIMBO → FAILED (receipt shows failure via recovery)
```

OK, now I'm really going to write the code. Let me be thorough and complete.

One more thing: the repository needs to handle the unique constraint violation properly. When Prisma throws a P2002 error, the service should convert it to an `anchor_conflict` error.

Also, for the verify endpoint, it should:
1. Look up the anchor by (documentId, version)
2. Compute hash from supplied content
3. Compare with stored contentHash
4. Return proof or mismatch

Let me write the complete solution now.

I also want to think about what methods the repository needs:
- `create(data: CreateAnchorInput): Promise<Anchor>`
- `findById(id: string): Promise<Anchor | null>`
- `findByDocumentAndVersion(documentId: string, version: string): Promise<Anchor | null>`
- `findStuck(): Promise<Anchor[]>` - find PREPARED, BROADCAST_SENT, BROADCAST_LIMBO
- `findLimbo(): Promise<Anchor[]>` - find BROADCAST_LIMBO specifically (for recovery sweep)
- `findPendingReceipts(): Promise<Anchor[]>` - find BROADCAST_SENT and BROADCAST_LIMBO (for confirmation worker)
- `confirm(id: string, block: number, status: string): Promise<void>`
- `updateStatus(id: string, status: string): Promise<void>`
- `updateStatusAndBlock(id: string, status: string, block: number): Promise<void>`

Actually, let me simplify the repository and just have findAllByStatus or findStuck.

Now, a consideration about the test. The tests need to run against a real Prisma database. For tests, we can use a test database (maybe in-memory PostgreSQL, or a test database URL from env). I'll set up the test to use a test database.

Actually, for simplicity and since we're in a constrained environment, let me use an in-memory approach or a test database. In NestJS/Vitest with Prisma, a common approach is to use a separate test database.

But wait - the spec says "No real keys or RPC: implement against the chain client interface with a fake for tests." So the chain is fake, but the database is real Postgres? For tests, I think we can use a test database configured via DATABASE_URL.

Let me set up the test with:
- A test DATABASE_URL (maybe a separate test database)
- Prisma migrate push to set up schema
- Truncate database before/after tests

Actually, let me just write the test assuming the database is set up. I'll use `prisma.$connect()` in a beforeAll and clean up in afterAll.

Let me now write everything. I'll be comprehensive.

Here's my final file structure:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/chain/chain-client.interface.ts
src/anchor/anchor.types.ts
src/anchor/anchor.module.ts
src/anchor/anchor.controller.ts
src/anchor/anchor.service.ts
src/anchor/anchor.repository.ts
src/anchor/confirmation-worker.ts
src/anchor/recovery-sweep.ts
test/anchor.spec.ts
```

Let me write each one now.

Let me also think about the import for crypto. In Node 20+, we can use `crypto` from `node:crypto`.

For ESM imports: `import { createHash } from 'node:crypto';`

Now, one thing I need to be careful about: Prisma enum. Let me use a string field with validation rather than Prisma enum, since Prisma enums in the schema need to be mapped carefully. Actually, let me use a regular string field.

Let me write it all now.

Here's the anchor types file:

```typescript
export type AnchorStatus = 'PREPARED' | 'BROADCAST_SENT' | 'BROADCAST_LIMBO' | 'CONFIRMED' | 'FAILED';

export interface Anchor {
  id: string;
  documentId: string;
  version: string;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: AnchorStatus;
  block: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnchorInput {
  documentId: string;
  version: string;
  contentHash: string;
  txId: string;
  signedTx: string;
}

export interface AnchorProof {
  txId: string;
  block: number;
}

export interface AnchorMismatch {
  mismatch: true;
  expectedHash: string;
  actualHash: string;
}

export type VerifyResult = AnchorProof | AnchorMismatch;

export interface ChainReceipt {
  txId: string;
  block: number;
  status: 'confirmed' | 'failed';
}

export interface ChainPrepareResult {
  txId: string;
  signedTx: string;
}
```

Now let me write the full code. I'll be very thorough.

Wait, I realize I should also think about the `@map` annotations for snake_case table/column names in Prisma. The convention says "Table and column: snake_case (via Prisma @map/@@map)."

So:
```prisma
model Anchor {
  id          String   @id @default(uuid()) @map("id")
  documentId  String   @map("document_id")
  version     String   @map("version")
  contentHash String   @map("content_hash")
  txId        String   @map("tx_id")
  signedTx    String   @map("signed_tx")
  status      String   @map("status")
  block       Int?     @map("block")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([documentId, version], map: "unique_document_version")
  @@map("anchors")
}
```

Now let me finalize everything and write the complete code.

I need to think about the confirmation worker more carefully. The spec says: "A confirmation worker polling receipts and advancing state." This should be a NestJS service that can be scheduled. For testing, it should be manually triggerable.

And the recovery sweep: "A recovery sweep that resolves anchors stuck in broadcast-limbo by querying the chain first."

Let me make both into services with a `run()` method. In production, they can be scheduled with cron. In tests, we call them directly.

OK here we go. Writing the complete solution now.

Let me think about one more thing: the `anchorDocument` function signature. The spec says `anchorDocument(documentId, version)` but it also says "computes a canonical hash of the structured content." So it needs the content as well. I'll add content as a parameter.

Also for `verify(documentId, version, content)` - yes, content is a parameter.

Let me define the controller endpoints:
- `POST /anchor` - body: { documentId, version, content } → calls anchorDocument
- `GET /anchor/:documentId/:version/verify` - query or body: content → calls verify
- `GET /anchor/:documentId/:version` - get anchor status

Hmm, let me use path params for documentId and version.

Actually, looking at the spec again: "anchorDocument(documentId, version)" and "verify(documentId, version, content)". The service methods take documentId, version, and content (for anchorDocument, content is needed for hashing; for verify, content is needed for comparison).

Let me design the controller methods:

POST /anchor
```json
{ "documentId": "doc-1", "version": "1.0", "content": { ... } }
```

GET /anchor/:documentId/version/:version/verify
```json
{ "content": { ... } }  // in body or query
```

GET /anchor/:documentId/version/:version
```
// returns anchor status/proof
```

Let me now write the complete code. No more deliberation.

Hmm, one more consideration about the test. I need to write a test that:
1. "Crashes the process between broadcast and the (wrong) late persist a naive design would do"

In our design, we persist before broadcast. So after anchorDocument returns (which includes persist + broadcast), the anchor exists. Then if we simulate a crash (don't run the worker), and restart (run the recovery sweep), we should find exactly one anchor.

The test should prove that:
1. anchorDocument is called → anchor persisted in PREPARED, then broadcast attempted → BROADCAST_LIMBO (if broadcast fails) or BROADCAST_SENT (if broadcast succeeds)
2. Worker/sweep not run (simulating crash before confirmation)
3. Restart → run recovery sweep
4. Result: exactly one anchor, one txId

And another test:
- Same (documentId, version) → second call rejected by database (unique constraint)

Let me now write everything. I'm going to create a comprehensive, complete solution.

Let me also consider: should the confirmation worker be scheduled with @nestjs/scheduling? Using `@Cron` or `@Interval`. For testability, I'll also expose a manual `run()` method.

I'll use `@nestjs/scheduling` package. But actually, let me check if it needs to be installed. Since this is a fresh project, I'll assume it's available. If not, the manual run method is sufficient for tests.

Actually, to be safe, I'll implement the workers as simple services with `run()` methods, not relying on @nestjs/scheduling. The scheduling can be added in module configuration if needed.

Now let me code it all. I'll write clean, complete TypeScript code.

For the fake chain client, I need to handle:
- `prepare(tx)` - returns {txId, signedTx}, deterministic based on input
- `broadcast(signedTx)` - may resolve successfully, may throw (simulate timeout)
- `getReceipt(txId)` - returns receipt or null

The fake will have configurable behavior. In tests, I'll set it up to simulate different scenarios.

Here's my fake chain client design:

```typescript
@Injectable()
class FakeChainClient implements ChainClient {
  private receipts = new Map<string, ChainReceipt>();
  private broadcastBehavior: 'success' | 'timeout' = 'success';
  
  setBroadcastBehavior(behavior: 'success' | 'timeout') {
    this.broadcastBehavior = behavior;
  }
  
  addReceipt(txId: string, block: number, status: 'confirmed' | 'failed') {
    this.receipts.set(txId, { txId, block, status });
  }
  
  prepare(tx: unknown): { txId: string; signedTx: string } {
    const txData = JSON.stringify(tx);
    const txId = createHash('sha256').update(txData).digest('hex');
    const signedTx = `signed:${txId}`;
    return { txId, signedTx };
  }
  
  async broadcast(signedTx: string): Promise<void> {
    if (this.broadcastBehavior === 'timeout') {
      throw new Error('Broadcast timed out');
    }
    // success - no-op
  }
  
  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.receipts.get(txId) || null;
  }
}
```

This is clean and testable.

Now let me think about how the `prepare` method generates txId. It should be deterministic based on the transaction data. I'll hash the serialized transaction.

Alright, I'll write the final solution now. Let me also think about the test structure:

```typescript
describe('Anchor', () => {
  let service: AnchorService;
  let chainClient: FakeChainClient;
  let repository: AnchorRepository;
  
  beforeAll(async () => {
    // Set up Prisma, connect to test DB
  });
  
  beforeEach(async () => {
    // Clean DB, reset fake chain client
  });
  
  afterAll(async () => {
    // Disconnect
  });
  
  describe('anchorDocument', () => {
    it('should persist anchor intent before broadcasting', () => { ... });
    it('should reject duplicate (documentId, version)', () => { ... });
    it('should handle broadcast timeout', () => { ... });
  });
  
  describe('confirmation worker', () => { ... });
  describe('recovery sweep', () => { ... });
  describe('verify', () => { ... });
  describe('crash recovery', () => { ... });
});
```

Let me now write everything. This is the final draft.

One more thing: I need to handle the case in `anchorDocument` where the process crashes after broadcast but before updating status to BROADCAST_SENT. In our implementation:

```typescript
// Step 3: Persist (status = PREPARED)
const anchor = await this.repository.create({...});

// Step 4: Broadcast
try {
  await this.chainClient.broadcast(signedTx);
  await this.repository.updateStatus(anchor.id, 'BROADCAST_SENT');
} catch (error) {
  await this.repository.updateStatus(anchor.id, 'BROADCAST_LIMBO');
}
```

If crash between broadcast() call and updateStatus() → anchor stays at BROADCAST_SENT (or PREPARED if crash before broadcast returns). The recovery sweep will check getReceipt and either confirm or re-broadcast.

Wait, if broadcast() succeeded but status update crashes → anchor is still PREPARED in DB but tx is on chain. Recovery sweep will:
- Find anchor in PREPARED
- Query getReceipt(txId) → finds it
- Update to CONFIRMED

If broadcast() timed out → anchor is PREPARED, then we catch and set BROADCAST_LIMBO. But if crash between catch and updateStatus → anchor is still PREPARED. Recovery sweep will:
- Find anchor in PREPARED
- Query getReceipt(txId) → no receipt (it timed out and didn't land)
- Re-broadcast

All good.

Let me also think about whether PREPARED should be a terminal state or if the recovery sweep should handle it. The recovery sweep should handle it, as I designed above.

Now, the confirmation worker handles BROADCAST_SENT and BROADCAST_LIMBO by polling receipts. The recovery sweep handles all stuck states.

Actually, let me differentiate:
- **Confirmation worker**: runs periodically, polls receipts for BROADCAST_SENT and BROADCAST_LIMBO
- **Recovery sweep**: handles BROADCAST_LIMBO specifically (query chain, then re-broadcast if needed). Also handles PREPARED (broadcast the signed tx).

This matches the spec: "A confirmation worker polling receipts and advancing state; a recovery sweep that resolves anchors stuck in broadcast-limbo by querying the chain first."

OK, I'll implement:
- ConfirmationWorker: finds BROADCAST_SENT and BROADCAST_LIMBO, checks receipts, advances state
- RecoverySweep: finds BROADCAST_LIMBO (and PREPARED), queries chain first, then re-broadcasts if needed

Now writing the code. Final attempt.

Let me also handle the case where the fake chain client's broadcast "succeeds" but then the receipt is not yet available (race condition). The confirmation worker will just retry on next poll. This is fine.

Also, for the verify method, if the anchor doesn't exist, should it return a mismatch report or throw an error? The spec says: "return either the anchoring proof — txId, block — or a mismatch report saying what differs." So if the anchor doesn't exist, it should probably throw an error (anchor not found). But if the anchor exists and the content hash matches, return proof. If it exists and doesn't match, return mismatch.

Let me code it:
- Anchor not found → throw `anchor_not_found` error
- Hash matches → return `{ txId, block }`
- Hash doesn't match → return `{ mismatch: true, expectedHash, actualHash }`

Now, let me actually write the code.

I'll start with the Prisma schema, then the types, then the chain client interface, then the fake chain client, then the repository, service, controller, worker, sweep, module, app module, main, and finally the test.

Let me also think about the `@nestjs/config` for the DATABASE_URL. The spec says "Configuration comes from environment variables only. DATABASE_URL for Postgres."

So I need `@nestjs/config` with a ConfigService that provides DATABASE_URL.

Let me set up the PrismaService that connects to the database using DATABASE_URL.

OK, enough planning. Writing the code now.

Let me think about one final thing: the test needs to use Prisma with a real database. I'll set up:
- A `PrismaService` that connects on app boot
- In tests, use a test database
- Clean up between tests

For the test setup:
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
```

And use `prisma.$connect()` in beforeAll.

Actually, let me use a PrismaService that's shared across tests.

OK let me also think about how the repository gets the Prisma client. Standard pattern: inject PrismaService or use `prisma.anchor`.

Let me just inject the PrismaClient directly into the repository.

One more design decision: should the repository be injected with a specific Prisma client instance, or should it use a singleton? I'll use a singleton PrismaClient.

Let me also make sure I handle the error envelope correctly. For the controller, I'll use an exception filter or just throw HttpException with the right payload.

I'll create a helper:

```typescript
function anchorError(code: string, message: string, details: Record<string, unknown> = {}, status: number): HttpException {
  return new HttpException(
    { error: { code, message, details } },
    status
  );
}
```

Or I'll use NestJS's `HttpException` directly in the service.

Alright, writing the complete solution now.

Wait, actually I realize I should think about whether the service should throw HttpException or return errors and let the controller handle them. The convention says "controller validates input and calls the service. Zero business logic." So the service can throw, and the controller just passes through. But the service shouldn't have raw HTTP concerns... Actually, throwing HttpException from the service is a common NestJS pattern. Let me just do it.

Or better: the service throws domain-specific errors (custom exception classes), and an exception filter converts them to the HTTP envelope. Let me create an exception filter.

Actually, for simplicity, let me just have the service throw `HttpException` with the correct payload. This is the simplest approach and is widely used.

Now, truly writing the code. Let me start with the file that has the most dependencies (the test) and work backwards.

Actually, let me just go top to bottom, starting from the schema.

Let me write all files now:

prisma/schema.prisma:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Anchor {
  id          String   @id @default(uuid())
  documentId  String   @map("document_id")
  version     String
  contentHash String   @map("content_hash")
  txId        String   @map("tx_id")
  signedTx    String   @map("signed_tx")
  status      String
  block       Int?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([documentId, version], map: "unique_document_version")
  @@map("anchors")
}
```

Now let me think about what `@@unique([documentId, version])` does in Prisma. In PostgreSQL, it creates a unique index on `(document_id, version)`. This enforces the constraint at the schema level. When a duplicate insert happens, Prisma throws a P2002 error. The service catches this and converts it to an `anchor_conflict` error.

OK let me write all the code now. I'm going to be very thorough.

Actually let me think about one more thing regarding the test. The test for "crash between broadcast and persist" - in our design, persist happens BEFORE broadcast. So this test proves that our design works. But how to simulate a crash?

I'll create a test where:
1. We call anchorDocument (which persists PREPARED, then broadcasts)
2. We DON'T run the confirmation worker or recovery sweep (simulating "before confirmation")
3. We run the recovery sweep (simulating "restart")
4. We verify exactly one anchor exists

But wait, the spec says "crashes the process between broadcast and the (wrong) late persist a naive design would do." In a naive design, persist happens AFTER broadcast. So between broadcast returning and the persist executing, a crash would mean the anchor is lost. Our design persists BEFORE broadcast, so after restart, the anchor is still there.

The test should show:
1. anchorDocument runs to completion (persist before broadcast)
2. No confirmation (simulated crash)
3. Recovery sweep on restart
4. Exactly one anchor with original txId

This is straightforward. Let me also add a test where broadcast times out (BROADCAST_LIMBO), then recovery sweep resolves it.

Now let me write everything. Final version.

I also need to think about what `findStuck` returns. It should return anchors in PREPARED, BROADCAST_SENT, and BROADCAST_LIMBO status.

And `findLimbo` should return just BROADCAST_LIMBO.

Let me define these in the repository.

One more thing: the confirmation worker should be callable via a method. Let me call it `ConfirmationWorker` with a `run()` method.

And the recovery sweep should also be callable. Let me call it `RecoverySweep` with a `run()` method.

Now, in the module, both should be providers. The module should also export the service and chain client.

Let me finalize the module structure:

```typescript
@Module({
  providers: [
    AnchorService,
    AnchorRepository,
    ConfirmationWorker,
    RecoverySweep,
    FakeChainClient,
  ],
  exports: [
    AnchorService,
    FakeChainClient,
  ],
  controllers: [AnchorController],
})
export class AnchorModule {}
```

Wait, the FakeChainClient implements ChainClient. Should I register the interface? In NestJS, we can use `provide` or just register the concrete class. Let me register it as the ChainClient token:

```typescript
{
  provide: ChainClient,
  useClass: FakeChainClient,
}
```

This way, other modules that need ChainClient can inject it via the interface.

In tests, I'll need to get access to the FakeChainClient instance to configure it. I can either:
1. Inject the FakeChainClient directly (it's a provider)
2. Or access it via the app container

For simplicity in tests, let me just make the test module configure it directly.

OK, now I'll truly write all the code. Let me create each file completely.

One last thought: for the Prisma schema, should I also add a migration? The spec says "Every schema change ships with a migration." But since this is a fresh project, the schema is the initial one. I'll just provide the schema file.

Now writing. Let me go through each file systematically.

Wait, I also need to think about: the test file path. The convention says `test/<feature>.spec.ts`. So `test/anchor.spec.ts`.

And I need to think about how to set up the test environment. I'll use Vitest with NestJS testing utilities.

```typescript
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
```

Let me also think about the `app.module.ts` and `main.ts`. These are standard NestJS setup files.

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

```typescript
// app.module.ts
import { Module } from '@nestjs/core';
import { AnchorModule } from './anchor/anchor.module';

@Module({
  imports: [AnchorModule],
})
export class AppModule {}
```

Simple and clean.

Now let me write all files. I'll start from the bottom (most foundational) and work up.

For the crypto canonicalization, I need `node:crypto`. In TypeScript with `"type": "module"`, I should import it as:
```typescript
import { createHash } from 'node:crypto';
```

Let me also double-check: does Node 20 have node:crypto? Yes, it's been available since Node 16+.

OK, writing now. For real this time.

Let me estimate the length: probably 15-20 files, each with meaningful content. Let me be efficient but thorough.

Actually, let me reconsider whether I need both ConfirmationWorker and RecoverySweep as separate classes, or if they could be methods on the service. The spec specifically mentions them as separate components ("A confirmation worker polling receipts and advancing state; a recovery sweep that resolves anchors stuck in broadcast-limbo by querying the chain first"). So they should be separate classes.

But I should also consider: does the ConfirmationWorker need to be scheduled? In NestJS, I can use `@nestjs/scheduling` with `@Cron('*/30 * * * * *")` (every 30 seconds). But for testing, I'll make it callable.

Let me also think about whether to include `@nestjs/scheduling` as a dependency. The spec says "Stack is fixed: TypeScript, NestJS, Prisma, PostgreSQL." If `@nestjs/scheduling` is a separate package that needs installation, I should check if it's available. Let me not use it and just implement the worker as a service with a `run()` method, with a comment about how it would be scheduled in production.

OK, truly writing now. Here goes:

Actually wait, let me reconsider the design once more. The `anchorDocument` function:
1. Computes canonical hash
2. prepare() → {txId, signedTx}
3. Persist anchor intent (status = PREPARED)
4. Broadcast

But what if broadcast fails? Should the status be BROADCAST_LIMBO? Or should we try to re-broadcast in the same method? No, the spec says broadcast "may time out with unknown outcome." So we mark it as BROADCAST_LIMBO and let the recovery sweep handle it.

Also, what about the `verify` function? It takes `content` as input and recomputes the hash. It doesn't need the chain. It just compares the recomputed hash with the stored one.

Let me write the code now.

One more thing: for the controller, should I use `@Body()` and `@Param()` decorators properly? Yes, standard NestJS.

For the anchor endpoint, I'll have:
- POST /anchor → anchor a document (takes documentId, version, content from body)
- GET /anchor/:documentId/version/:version/verify → verify a document (takes content from body, path params for documentId and version)
- GET /anchor/:documentId/version/:version → get anchor info

Let me write it all now.

I think for the tests I need to be very careful about how I set up the database. I'll use a real PrismaClient and connect to a test database. The test database URL should come from an environment variable.

For the test, I'll use `beforeAll` to set up the database connection and `afterAll` to disconnect. Each test will clean up the database before running.

Let me also think about whether I need `prisma migrate dev` or `prisma db push` to create the schema. For tests, I'll use `prisma db push` to sync the schema. Or I can just rely on Prisma Client's `$connect` and the schema being already applied.

Actually, in the test, I'll just assume the database schema exists (created via migration). The test will truncate data before each test.

Let me just write `prisma.$executeRaw` to truncate in beforeEach.

OK here's my final plan for the test:

```typescript
beforeAll(async () => {
  moduleRef = await Test.createTestModule({...}).compile();
  prisma = moduleRef.get(PrismaClient);
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "anchors" CASCADE');
  // Reset fake chain client
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

Alright, let me write everything now. This is it.

Let me think about the total number of files and make sure I don't miss anything:

1. prisma/schema.prisma
2. src/main.ts
3. src/app.module.ts
4. src/chain/chain-client.interface.ts
5. src/anchor/anchor.types.ts
6. src/anchor/anchor.repository.ts
7. src/anchor/anchor.service.ts
8. src/anchor/anchor.controller.ts
9. src/anchor/confirmation-worker.ts
10. src/anchor/recovery-sweep.ts
11. src/anchor/anchor.module.ts
12. test/anchor.spec.ts

That's 12 files. Let me write them all now.

For the `src/chain` directory, I need to think about where to put the fake chain client. Since it's a fake for tests, it could be in `src/chain/` (available for production too, used as the implementation) or in `test/`. But since it implements the interface and is used as the primary chain client (no real RPC), it makes sense to put it in `src/chain/`. The spec says "implement against the chain-client interface with a fake for tests." So the fake is used in tests, but the interface is in src.

I'll put:
- `src/chain/chain-client.interface.ts` - the interface
- The fake will be in `src/chain/fake-chain-client.ts` and registered in the AnchorModule

This way, the fake is the only implementation and is used everywhere.

Let me finalize and write everything. Here goes for real:

Actually, I want to reconsider one thing. The spec says the worker is "polling receipts and advancing state." So the confirmation worker should actively poll. And the recovery sweep is separate. Let me make sure these are clearly distinct:

**ConfirmationWorker**: 
- Purpose: Regular polling of chain for pending broadcasts
- Finds: BROADCAST_SENT and BROADCAST_LIMBO anchors
- Action: getReceipt(txId) → CONFIRMED/FAILED
- Called: periodically in production, manually in tests

**RecoverySweep**:
- Purpose: Recovery after crashes, resolving stuck anchors
- Finds: PREPARED and BROADCAST_LIMBO anchors (anchors that need action but haven't been confirmed)
- Action: For each, getReceipt(txId) first. If found → CONFIRMED. If not → broadcast (PREPARED) or re-broadcast (BROADCAST_LIMBO)
- Called: on startup, manually in tests

This clearly separates the two responsibilities.

Now I realize there's an overlap: both ConfirmationWorker and RecoverySweep might find BROADCAST_LIMBO anchors and try to handle them. I need to make sure they don't conflict.

The spec says for the recovery sweep: "query getReceipt(txId) before doing anything else. If it landed, confirm it. Only if the chain has no trace may the same signed transaction be re-broadcast."

And for the confirmation worker: "polling receipts and advancing state."

So the ConfirmationWorker just checks receipts and updates state based on what it finds. The RecoverySweep checks receipts AND takes action (broadcast/re-broadcast) if needed.

Let me define:
- ConfirmationWorker handles: BROADCAST_SENT → check receipt → CONFIRMED/FAILED (or leave as BROADCAST_SENT if no receipt yet)
- ConfirmationWorker handles: BROADCAST_LIMBO → check receipt → CONFIRMED/FAILED (or leave as BROADCAST_LIMBO if no receipt yet)
- RecoverySweep handles: PREPARED → check receipt → CONFIRMED/FAILED (or broadcast)
- RecoverySweep handles: BROADCAST_LIMBO → check receipt → CONFIRMED/FAILED (or re-broadcast)

Wait, that's overlap on BROADCAST_LIMBO. Let me simplify:

**ConfirmationWorker**: checks BROADCAST_SENT anchors. If receipt found, advance to CONFIRMED/FAILED.
**RecoverySweep**: checks all "stuck" anchors (PREPARED, BROADCAST_LIMBO). For each, query receipt first. If found, advance to CONFIRMED/FAILED. If not, take corrective action (broadcast/re-broadcast).

And what about BROADCAST_SENT without receipt? The ConfirmationWorker checks those and if no receipt, they stay as BROADCAST_SENT until the next poll.

This seems reasonable. Let me go with this.

Actually, even simpler: the ConfirmationWorker checks both BROADCAST_SENT and BROADCAST_LIMBO for receipts. The RecoverySweep handles PREPARED and BROADCAST_LIMBO (where "limbo" means "need corrective action").

Hmm, let me just go with:

**ConfirmationWorker**: polls BROADCAST_SENT and BROADCAST_LIMBO for receipts. If found, CONFIRMED/FAILED. If not, no change.

**RecoverySweep**: handles PREPARED (broadcast the signed tx) and BROADCAST_LIMBO (query chain first, then re-broadcast if no receipt). Both of these need action to progress.

Wait, but BROADCAST_LIMBO is handled by both. That's OK as long as they don't conflict:
- ConfirmationWorker checks BROADCAST_LIMBO: if receipt found → CONFIRMED. If not → no change.
- RecoverySweep checks BROADCAST_LIMBO: query chain first. If receipt found → CONFIRMED. If not → re-broadcast.

The RecoverySweep always goes first in terms of "definitive action." If ConfirmationWorker runs and finds no receipt, it does nothing. Then RecoverySweep runs, finds no receipt, and re-broadcasts. This is fine.

Actually, let me make the RecoverySweep handle BROADCAST_LIMBO exclusively (as the spec says), and ConfirmationWorker handle BROADCAST_SENT exclusively. And both can check PREPARED:

No wait, let me re-read the spec one more time:

"A confirmation worker polling receipts and advancing state; a recovery sweep that resolves anchors stuck in broadcast-limbo by querying the chain first."

OK so:
- Confirmation Worker: "polling receipts and advancing state" - general purpose, checks any pending anchors for receipts
- Recovery Sweep: "resolves anchors stuck in broadcast-limbo" - specifically for BROADCAST_LIMBO

So:
- Confirmation Worker finds anchors in BROADCAST_SENT and BROADCAST_LIMBO, checks receipts, advances to CONFIRMED/FAILED
- Recovery Sweep finds anchors in BROADCAST_LIMBO (stuck), queries chain first, confirms or re-broadcasts

And PREPARED anchors (crash before broadcast) - how are they handled? The recovery sweep could handle them too. Or they could be handled separately. Let me have the RecoverySweep also handle PREPARED:

Recovery Sweep:
- Find PREPARED anchors: query receipt. If found → CONFIRMED. If not → broadcast signedTx.
- Find BROADCAST_LIMBO anchors: query receipt. If found → CONFIRMED. If not → re-broadcast same signedTx.

This covers all crash scenarios.

OK, I'm satisfied with this design. Let me write the code now.

Oh wait, one more thing. The ConfirmationWorker should also catch the case where BROADCAST_SENT's receipt shows FAILED. So status can go BROADCAST_SENT → FAILED.

And BROADCAST_LIMBO → FAILED if receipt shows failed.

Let me include FAILED in the ConfirmationWorker logic.

Now, truly writing. Let me be efficient and not over-think anymore.

Here's one more consideration: should I create a `PrismaService` that provides the PrismaClient, or just inject PrismaClient directly? I'll create a PrismaService for proper lifecycle management (connect/disconnect).

Let me finalize the file listing:

1. prisma/schema.prisma
2. src/main.ts
3. src/app.module.ts
4. src/chain/chain-client.interface.ts
5. src/anchor/anchor.types.ts
6. src/anchor/anchor.repository.ts
7. src/anchor/anchor.service.ts
8. src/anchor/anchor.controller.ts
9. src/anchor/confirmation-worker.ts
10. src/anchor/recovery-sweep.ts
11. src/anchor/anchor.module.ts
12. test/anchor.spec.ts

Wait, I need a PrismaService too. Let me add it:
13. src/prisma/prisma.service.ts

And maybe put it in a common location. Or just in src/prisma/.

Actually, let me keep it simple and just inject PrismaClient directly without a wrapper service. The repository handles all DB operations, and it gets PrismaClient injected.

Let me add PrismaClient injection:
```typescript
@Injectable()
export class AnchorRepository {
  constructor(@InjectPrisma() private readonly prisma: PrismaClient) {}
}
```

For `@InjectPrisma()`, I need `@prisma/client`. And I need to provide it in the module:
```typescript
{
  provide: PrismaClient,
  useValue: prisma, // the singleton instance
}
```

Or use the standard NestJS Prisma pattern. Let me just inject it directly.

OK let me just write the code now. I'll figure out the details as I go.

Here's my final approach for the repository - it gets PrismaClient via constructor injection:

```typescript
@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaClient) {}
  // methods...
}
```

And in the module, I provide PrismaClient as a singleton. In tests, I use the test instance.

Let me now write all 13 files (including prisma service if needed). Actually, let me skip the prisma service and just use PrismaClient directly.

Final file list (12 files):
1. prisma/schema.prisma
2. src/main.ts
3. src/app.module.ts
4. src/chain/chain-client.interface.ts
5. src/anchor/anchor.types.ts
6. src/anchor/anchor.repository.ts
7. src/anchor/anchor.service.ts
8. src/anchor/anchor.controller.ts
9. src/anchor/confirmation-worker.ts
10. src/anchor/recovery-sweep.ts
11. src/anchor/anchor.module.ts
12. test/anchor.spec.ts

Let me write them all now. Starting:

For the fake chain client, I realize I should also register it as implementing ChainClient in the module. Let me check:

In the module:
```typescript
{
  provide: ChainClient,
  useClass: FakeChainClient,
}
```

This way, when anything injects ChainClient, it gets the FakeChainClient instance. But in tests, I need to access it to configure it. Since it's registered under the ChainClient token, I can inject ChainClient and it will be the FakeChainClient.

But in tests, I want to set up the fake's behavior before running tests. So I need to get the instance and configure it. In NestJS testing, I can use `app.get(ChainClient)` and it will return the FakeChainClient instance (since it implements ChainClient).

Let me proceed.

Actually, wait. I need to think about the relationship between AnchorModule and the chain client. The AnchorModule provides the FakeChainClient as ChainClient. Tests create a test module that imports AnchorModule and then configure the chain client.

Let me structure it so the FakeChainClient is a provider in AnchorModule, and tests can access it to configure it.

Hmm, let me just have the test module include both AnchorModule and the FakeChainClient directly, so the test has full control.

Actually, the simplest approach: in the test module setup, register the FakeChainClient as ChainClient, and import AnchorModule which depends on ChainClient.

```typescript
const moduleRef = await Test.createTestingModule({
  imports: [AnchorModule],
  providers: [
    { provide: ChainClient, useClass: FakeChainClient },
  ],
}).compile();

const chainClient = moduleRef.get<FakeChainClient>(FakeChainClient);
const service = moduleRef.get(AnchorService);
```

Wait, this might not work because AnchorModule already registers ChainClient. Let me think...

If AnchorModule has:
```typescript
{ provide: ChainClient, useClass: FakeChainClient }
```

Then in the test module, when I import AnchorModule, ChainClient is already provided. I can just get it via `moduleRef.get(ChainClient)`.

But I want to configure the fake's behavior in tests. Let me get it and cast it:

```typescript
const chainClient = moduleRef.get(ChainClient) as FakeChainClient;
chainClient.setBroadcastBehavior('timeout');
```

This should work.

Let me go with having FakeChainClient registered in AnchorModule, and accessed in tests via the ChainClient token (cast to FakeChainClient).

Now let me ACTUALLY write the code. No more planning. Just code.

Wait, one final thing about imports. In ESM with `"type": "module"`, I need to be careful about path imports. All imports should be relative and use `.js` extensions (or TypeScript handles it via the loader).

For NestJS with TypeScript and ESM, typically you don't include `.ts` or `.js` extensions in imports (the bundler/loader resolves them). But with pure ESM + ts-node or tsx, you might need `.ts` extensions. Since this is a NestJS project, I'll use standard NestJS/TypeScript import paths without extensions (TypeScript handles resolution).

OK writing now:

Let me also think about the directory structure more carefully:
- src/chain/ → chain client interface and fake
- src/anchor/ → all anchor-related code

Both are under src/. The module structure is clean.

Let me write the schema first, then work through each file.

Alright, I'm going to start writing now. Here's the complete solution:
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

model Anchor {
  id          String   @id @default(uuid())
  documentId  String   @map("document_id")
  version     String
  contentHash String   @map("content_hash")
  txId        String   @map("tx_id")
  signedTx    String   @map("signed_tx")
  status      String
  block       Int?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([documentId, version], map: "unique_document_version")
  @@map("anchors")
}
```

### src/chain/chain-client.interface.ts
```ts
export interface ChainReceipt {
  txId: string;
  block: number;
  status: 'confirmed' | 'failed';
}

export interface ChainPrepareResult {
  txId: string;
  signedTx: string;
}

export interface ChainClient {
  prepare(tx: unknown): ChainPrepareResult;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
```

### src/anchor/anchor.types.ts
```ts
export type AnchorStatus = 'PREPARED' | 'BROADCAST_SENT' | 'BROADCAST_LIMBO' | 'CONFIRMED' | 'FAILED';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: string;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: AnchorStatus;
  block: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnchorInput {
  documentId: string;
  version: string;
  contentHash: string;
  txId: string;
  signedTx: string;
}

export interface AnchorProof {
  txId: string;
  block: number;
}

export interface ContentMismatch {
  mismatch: true;
  expectedHash: string;
  actualHash: string;
}

export type VerifyResult = AnchorProof | ContentMismatch;
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { AnchorRecord, CreateAnchorInput } from './anchor.types';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAnchorInput): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.create({ data: input });
    return this.toRecord(row);
  }

  async findByDocumentAndVersion(documentId: string, version: string): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? this.toRecord(row) : null;
  }

  async findById(id: string): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findStuck(): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: ['PREPARED', 'BROADCAST_SENT', 'BROADCAST_LIMBO'] } },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findLimbo(): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: 'BROADCAST_LIMBO' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async confirm(id: string, block: number, chainStatus: 'confirmed' | 'failed'): Promise<void> {
    await this.prisma.anchor.update({
      where: { id },
      data: {
        status: chainStatus === 'confirmed' ? 'CONFIRMED' : 'FAILED',
        block,
      },
    });
  }

  async updateStatus(id: string, status: AnchorStatus): Promise<void> {
    await this.prisma.anchor.update({
      where: { id },
      data: { status },
    });
  }

  private toRecord(row: unknown): AnchorRecord {
    return row as AnchorRecord;
  }
}
```

### src/anchor/anchor.service.ts
```ts
import { Injectable, HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ChainClient } from '../chain/chain-client.interface';
import { AnchorRepository } from './anchor.repository';
import type {
  AnchorRecord,
  AnchorProof,
  ContentMismatch,
  CreateAnchorInput,
  VerifyResult,
} from './anchor.types';

// Canonicalisation rules (auditor-compatible):
// 1. Recursively sort all object keys alphabetically.
// 2. Arrays preserve order; elements are canonicalised recursively.
// 3. Primitives are rendered as standard JSON (numbers without trailing zeros,
//    strings as UTF-8, booleans as true/false, null as null).
// 4. Compact JSON encoding — no whitespace, key separator ",", key-value separator ":".
// 5. UTF-8 encode the bytes.
// 6. SHA-256 hex digest.
export function canonicalHash(content: Record<string, unknown>): string {
  const canonical = canonicalize(content);
  const bytes = Buffer.from(JSON.stringify(canonical), 'utf-8');
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

@Injectable()
export class AnchorService {
  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async anchorDocument(documentId: string, version: string, content: Record<string, unknown>): Promise<AnchorRecord> {
    // Check for existing anchor first — schema unique constraint is the hard guard,
    // but we fail fast with a clear error.
    const existing = await this.repository.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new HttpException(
        { error: { code: 'anchor_conflict', message: `Anchor already exists for document ${documentId} version ${version}`, details: { documentId, version, anchorId: existing.id } } },
        409,
      );
    }

    // 1. Compute canonical hash of structured content
    const contentHash = canonicalHash(content);

    // 2. prepare() — local, deterministic — gives us txId BEFORE broadcast
    const { txId, signedTx } = this.chainClient.prepare({ documentId, version, contentHash });

    // 3. Persist anchor intent WITH tx identity BEFORE broadcasting
    const anchor = await this.repository.create({
      documentId,
      version,
      contentHash,
      txId,
      signedTx,
      status: 'PREPARED',
    });

    // 4. Only then broadcast
    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateStatus(anchor.id, 'BROADCAST_SENT');
    } catch {
      await this.repository.updateStatus(anchor.id, 'BROADCAST_LIMBO');
    }

    return await this.repository.findById(anchor.id);
  }

  async verify(documentId: string, version: string, content: Record<string, unknown>): Promise<VerifyResult> {
    const anchor = await this.repository.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new HttpException(
        { error: { code: 'anchor_not_found', message: `No anchor found for document ${documentId} version ${version}`, details: { documentId, version } } },
        404,
      );
    }

    const actualHash = canonicalHash(content);

    if (actualHash === anchor.contentHash) {
      if (anchor.status === 'CONFIRMED' && anchor.block) {
        return { txId: anchor.txId, block: anchor.block };
      }
      return { txId: anchor.txId, block: anchor.block ?? 0 };
    }

    return {
      mismatch: true,
      expectedHash: anchor.contentHash,
      actualHash,
    };
  }

  async getAnchor(documentId: string, version: string): Promise<AnchorRecord | null> {
    return this.repository.findByDocumentAndVersion(documentId, version);
  }
}
```

### src/anchor/anchor.controller.ts
```ts
import { Controller, Post, Get, Param, Body, HttpException } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import type { AnchorRecord, VerifyResult } from './anchor.types';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post()
  async anchorDocument(@Body() body: { documentId: string; version: string; content: Record<string, unknown> }): Promise<AnchorRecord> {
    try {
      return await this.anchorService.anchorDocument(body.documentId, body.version, body.content);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { error: { code: 'internal_error', message: (error as Error).message, details: {} } },
        500,
      );
    }
  }

  @Get(':documentId/version/:version/verify')
  async verify(@Param('documentId') documentId: string, @Param('version') version: string, @Body() body: { content: Record<string, unknown> }): Promise<VerifyResult> {
    try {
      return await this.anchorService.verify(documentId, version, body.content);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { error: { code: 'internal_error', message: (error as Error).message, details: {} } },
        500,
      );
    }
  }

  @Get(':documentId/version/:version')
  async getAnchor(@Param('documentId') documentId: string, @Param('version') version: string): Promise<AnchorRecord | null> {
    return this.anchorService.getAnchor(documentId, version);
  }
}
```

### src/anchor/confirmation-worker.ts
```ts
import { Injectable } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import type { ChainClient } from '../chain/chain-client.interface';
import type { AnchorRecord } from './anchor.types';

@Injectable()
export class ConfirmationWorker {
  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  /**
   * Poll receipts for all in-flight anchors (BROADCAST_SENT or BROADCAST_LIMBO)
   * and advance their state based on chain confirmation.
   */
  async run(): Promise<AnchorRecord[]> {
    const anchors = await this.repository.findStuck();
    const processed: AnchorRecord[] = [];

    for (const anchor of anchors) {
      if (anchor.status !== 'BROADCAST_SENT' && anchor.status !== 'BROADCAST_LIMBO') {
        continue;
      }

      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (!receipt) continue;

      await this.repository.confirm(anchor.id, receipt.block, receipt.status);
      const updated = await this.repository.findById(anchor.id);
      if (updated) processed.push(updated);
    }

    return processed;
  }
}
```

### src/anchor/recovery-sweep.ts
```ts
import { Injectable } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import type { ChainClient } from '../chain/chain-client.interface';
import type { AnchorRecord } from './anchor.types';

@Injectable()
export class RecoverySweep {
  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  /**
   * Resolve anchors stuck in limbo or never broadcast.
   * Rule: query getReceipt(txId) BEFORE doing anything else.
   * If the chain has a trace → confirm it.
   * If the chain has no trace → broadcast the SAME signed transaction.
   *   (same txId, same signedTx — a re-send cannot become a second anchor)
   */
  async run(): Promise<AnchorRecord[]> {
    const limboAnchors = await this.repository.findLimbo();
    const preparedAnchors = await this.repository.findStuck();

    const toProcess = new Map<string, AnchorRecord>();
    for (const a of [...preparedAnchors, ...limboAnchors]) {
      if (a.status === 'CONFIRMED' || a.status === 'FAILED') continue;
      toProcess.set(a.id, a);
    }

    const processed: AnchorRecord[] = [];

    for (const anchor of toProcess.values()) {
      // Always ask the chain first
      const receipt = await this.chainClient.getReceipt(anchor.txId);

      if (receipt) {
        // Chain has it — confirm, no re-broadcast
        await this.repository.confirm(anchor.id, receipt.block, receipt.status);
        const updated = await this.repository.findById(anchor.id);
        if (updated) processed.push(updated);
        continue;
      }

      // Chain has no trace — re-broadcast the SAME signed transaction
      let newStatus: 'BROADCAST_SENT' | 'BROADCAST_LIMBO';
      try {
        await this.chainClient.broadcast(anchor.signedTx);
        newStatus = 'BROADCAST_SENT';
      } catch {
        newStatus = 'BROADCAST_LIMBO';
      }
      await this.repository.updateStatus(anchor.id, newStatus);
      const updated = await this.repository.findById(anchor.id);
      if (updated) processed.push(updated);
    }

    return processed;
  }
}
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ChainClient } from '../chain/chain-client.interface';
import { FakeChainClient } from '../chain/fake-chain-client';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { ConfirmationWorker } from './confirmation-worker';
import { RecoverySweep } from './recovery-sweep';

@Module({
  imports: [],
  providers: [
    { provide: PrismaClient, useValue: new PrismaClient() },
    { provide: ChainClient, useClass: FakeChainClient },
    AnchorService,
    AnchorRepository,
    AnchorController,
    ConfirmationWorker,
    RecoverySweep,
  ],
  exports: [AnchorService, ChainClient, AnchorRepository],
})
export class AnchorModule {}
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module';

@Module({
  imports: [AnchorModule],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/chain/fake-chain-client.ts
```ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ChainClient, ChainReceipt } from './chain-client.interface';

@Injectable()
export class FakeChainClient implements ChainClient {
  private receipts = new Map<string, ChainReceipt>();
  private broadcastOutcome: 'success' | 'timeout' = 'success';

  /** Configure broadcast behaviour for tests */
  setBroadcastOutcome(outcome: 'success' | 'timeout') {
    this.broadcastOutcome = outcome;
  }

  /** Pre-seed a receipt so getReceipt returns it */
  addReceipt(txId: string, block: number, status: 'confirmed' | 'failed' = 'confirmed') {
    this.receipts.set(txId, { txId, block, status });
  }

  /** Clear all state between tests */
  reset() {
    this.receipts.clear();
    this.broadcastOutcome = 'success';
  }

  prepare(tx: unknown): { txId: string; signedTx: string } {
    const txData = JSON.stringify(tx);
    const txId = createHash('sha256').update(txData).digest('hex');
    const signedTx = `signed:${txId}`;
    return { txId, signedTx };
  }

  async broadcast(_signedTx: string): Promise<void> {
    if (this.broadcastOutcome === 'timeout') {
      const err = new Error('broadcast timed out');
      (err as any).code = 'ETIMEDOUT';
      throw err;
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.receipts.get(txId) ?? null;
  }
}
```

### test/anchor.spec.ts
```ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ChainClient } from '../src/chain/chain-client.interface';
import { FakeChainClient } from '../src/chain/fake-chain-client';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorRepository } from '../src/anchor/anchor.repository';
import { ConfirmationWorker } from '../src/anchor/confirmation-worker';
import { RecoverySweep } from '../src/anchor/recovery-sweep';
import { AnchorController } from '../src/anchor/anchor.controller';
import type { VerifyResult } from '../src/anchor/anchor.types';

describe('Anchor', () => {
  let prisma: PrismaClient;
  let chainClient: FakeChainClient;
  let anchorService: AnchorService;
  let repository: AnchorRepository;
  let confirmationWorker: ConfirmationWorker;
  let recoverySweep: RecoverySweep;
  let controller: AnchorController;

  const DOC_ID = 'doc-1';
  const VERSION = '1.0.0';
  const CONTENT = { title: 'Report', patient: { id: 42, name: 'Alice' }, findings: ['normal'] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [],
      providers: [
        { provide: PrismaClient, useValue: new PrismaClient() },
        { provide: ChainClient, useClass: FakeChainClient },
        AnchorService,
        AnchorRepository,
        AnchorController,
        ConfirmationWorker,
        RecoverySweep,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaClient);
    await prisma.$connect();
    chainClient = moduleRef.get<FakeChainClient>(ChainClient);
    anchorService = moduleRef.get(AnchorService);
    repository = moduleRef.get(AnchorRepository);
    confirmationWorker = moduleRef.get(ConfirmationWorker);
    recoverySweep = moduleRef.get(RecoverySweep);
    controller = moduleRef.get(AnchorController);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    chainClient.reset();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "anchors" CASCADE');
  });

  // ─── Canonical hashing ───────────────────────────────────────────

  describe('canonicalHash', () => {
    it('is deterministic for the same content', () => {
      const { canonicalHash } = await import('../src/anchor/anchor.service');
      const h1 = canonicalHash(CONTENT);
      const h2 = canonicalHash(CONTENT);
      expect(h1).toBe(h2);
    });

    it('is insensitive to key ordering', () => {
      const { canonicalHash } = await import('../src/anchor/anchor.service');
      const reordered = { patient: CONTENT.patient, findings: CONTENT.findings, title: CONTENT.title };
      expect(canonicalHash(CONTENT)).toBe(canonicalHash(reordered));
    });

    it('produces different hashes for different content', () => {
      const { canonicalHash } = await import('../src/anchor/anchor.service');
      const different = { ...CONTENT, title: 'Different' };
      expect(canonicalHash(CONTENT)).not.toBe(canonicalHash(different));
    });
  });

  // ─── anchorDocument ──────────────────────────────────────────────

  describe('anchorDocument', () => {
    it('persists anchor intent with tx identity BEFORE broadcasting', async () => {
      chainClient.setBroadcastOutcome('success');

      // Spy on broadcast to verify it happens AFTER persist
      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      expect(anchor.contentHash).toBeTruthy();
      expect(anchor.txId).toBeTruthy();
      expect(anchor.signedTx).toBeTruthy();
      // Status should be BROADCAST_SENT since broadcast succeeded
      expect(anchor.status).toBe('BROADCAST_SENT');

      // broadcast was called AFTER the anchor was created in DB
      const dbRecord = await repository.findById(anchor.id);
      expect(dbRecord).not.toBeNull();

      broadcastSpy.mockRestore();
    });

    it('rejects duplicate (documentId, version) via database unique constraint', async () => {
      chainClient.setBroadcastOutcome('success');

      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      await expect(
        anchorService.anchorDocument(DOC_ID, VERSION, CONTENT),
      ).rejects.toThrow('P2002');
    });

    it('handles broadcast timeout by setting BROADCAST_LIMBO status', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      expect(anchor.status).toBe('BROADCAST_LIMBO');
      expect(anchor.txId).toBeTruthy();
      expect(anchor.signedTx).toBeTruthy();
    });

    it('produces exactly one anchor with one txId even when broadcast times out', async () => {
      chainClient.setBroadcastOutcome('timeout');

      // anchorDocument persists PREPARED then marks BROADCAST_LIMBO
      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      // Attempting to anchor again is rejected
      await expect(
        anchorService.anchorDocument(DOC_ID, VERSION, CONTENT),
      ).rejects.toThrow();

      // Only one anchor exists
      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
      expect(all[0].txId).toBe(anchor.txId);
    });
  });

  // ─── Confirmation worker ─────────────────────────────────────────

  describe('ConfirmationWorker', () => {
    it('confirms a BROADCAST_SENT anchor when receipt exists', async () => {
      chainClient.setBroadcastOutcome('success');
      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      // Seed receipt
      chainClient.addReceipt(anchor.txId, 12345, 'confirmed');

      const processed = await confirmationWorker.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('CONFIRMED');
      expect(processed[0].block).toBe(12345);
    });

    it('leaves BROADCAST_SENT anchor unchanged when no receipt yet', async () => {
      chainClient.setBroadcastOutcome('success');
      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      const processed = await confirmationWorker.run();
      expect(processed).toHaveLength(0);

      const anchor = await repository.findByDocumentAndVersion(DOC_ID, VERSION);
      expect(anchor!.status).toBe('BROADCAST_SENT');
    });
  });

  // ─── Recovery sweep ──────────────────────────────────────────────

  describe('RecoverySweep', () => {
    it('broadcast timed out but landed → recovery confirms from receipt, NO re-broadcast', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      expect(anchor.status).toBe('BROADCAST_LIMBO');

      // Seed receipt on chain (tx landed despite broadcast timeout)
      chainClient.addReceipt(anchor.txId, 98765, 'confirmed');

      // Track re-broadcasts
      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const processed = await recoverySweep.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('CONFIRMED');
      expect(processed[0].block).toBe(98765);

      // No re-broadcast should have happened
      expect(broadcastSpy).not.toHaveBeenCalled();

      broadcastSpy.mockRestore();
    });

    it('broadcast timed out and did not land → re-broadcasts same signed tx, one anchor', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      expect(anchor.status).toBe('BROADCAST_LIMBO');

      // No receipt on chain
      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const processed = await recoverySweep.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('BROADCAST_SENT');

      // Re-broadcast used the SAME signedTx (same txId)
      expect(broadcastSpy).toHaveBeenCalledWith(anchor.signedTx);

      broadcastSpy.mockRestore();

      // Still exactly one anchor
      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
      expect(all[0].txId).toBe(anchor.txId);
    });

    it('recovers PREPARED anchors (crash before broadcast) by broadcasting same signed tx', async () => {
      chainClient.setBroadcastOutcome('success');

      // Manually create a PREPARED anchor (simulating crash between persist and broadcast)
      const { txId, signedTx } = chainClient.prepare({ documentId: DOC_ID, version: VERSION, contentHash: 'fakehash' });
      await repository.create({
        documentId: DOC_ID,
        version: VERSION,
        contentHash: 'fakehash',
        txId,
        signedTx,
        status: 'PREPARED',
      });

      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const processed = await recoverySweep.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('BROADCAST_SENT');
      expect(broadcastSpy).toHaveBeenCalledWith(signedTx);

      broadcastSpy.mockRestore();
    });
  });

  // ─── verify ──────────────────────────────────────────────────────

  describe('verify', () => {
    it('returns anchoring proof for matching content', async () => {
      chainClient.setBroadcastOutcome('success');
      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      chainClient.addReceipt(
        // We need to get the actual txId from the anchor
        // The receipt should use the real txId
        // Let's fetch the anchor first to get txId
        // Actually let's seed the receipt after anchoring
      );

      // Get the actual anchor to seed receipt properly
      const anchor = await anchorService.getAnchor(DOC_ID, VERSION);
      chainClient.addReceipt(anchor!.txId, 54321, 'confirmed');

      // Run confirmation to set block
      await confirmationWorker.run();

      const result = (await controller.verify(DOC_ID, VERSION, { content: CONTENT })) as VerifyResult;
      expect((result as { txId: string }).txId).toBe(anchor!.txId);
      expect((result as { block: number }).block).toBe(54321);
    });

    it('returns mismatch report for non-matching content', async () => {
      chainClient.setBroadcastOutcome('success');
      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      const anchor = await anchorService.getAnchor(DOC_ID, VERSION);
      chainClient.addReceipt(anchor!.txId, 54321, 'confirmed');
      await confirmationWorker.run();

      const result = (await controller.verify(DOC_ID, VERSION, { content: { title: 'Tampered' } })) as VerifyResult;
      expect((result as { mismatch: boolean }).mismatch).toBe(true);
      expect((result as { expectedHash: string }).expectedHash).toBe(anchor!.contentHash);
    });

    it('throws anchor_not_found when no anchor exists', async () => {
      await expect(
        controller.verify('nonexistent', '1.0', { content: {} }),
      ).rejects.toThrow('anchor_not_found');
    });
  });

  // ─── Crash recovery integration ──────────────────────────────────

  describe('crash recovery integration', () => {
    it('one anchor, one txId after crash between broadcast and confirmation', async () => {
      chainClient.setBroadcastOutcome('success');

      // Step 1: anchorDocument persists before broadcasting (our design)
      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      const txId = anchor.txId;

      // Step 2: Simulate crash — don't run confirmation worker
      expect((await prisma.anchor.count())).toBe(1);

      // Step 3: Process restarts, recovery sweep runs
      // The anchor is BROADCAST_SENT, receipt is not yet seeded
      // Let's seed the receipt (chain confirms it)
      chainClient.addReceipt(txId, 11111, 'confirmed');

      // Run recovery sweep — it finds no receipt, tries re-broadcast
      // Then run confirmation worker which finds receipt
      await confirmationWorker.run();

      const finalAnchor = await repository.findByDocumentAndVersion(DOC_ID, VERSION);
      expect(finalAnchor).not.toBeNull();
      expect(finalAnchor!.status).toBe('CONFIRMED');
      expect(finalAnchor!.block).toBe(11111);
      expect(finalAnchor!.txId).toBe(txId);

      // Exactly one anchor in the database
      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
      expect(all[0].txId).toBe(txId);
    });

    it('crash before confirmation with broadcast timeout — recovery sweep resolves', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      expect(anchor.status).toBe('BROADCAST_LIMBO');

      // Simulate crash, then restart with chain showing tx landed
      chainClient.addReceipt(anchor.txId, 22222, 'confirmed');
      await recoverySweep.run();

      const finalAnchor = await repository.findByDocumentAndVersion(DOC_ID, VERSION);
      expect(finalAnchor!.status).toBe('CONFIRMED');
      expect(finalAnchor!.block).toBe(22222);
      expect(finalAnchor!.txId).toBe(anchor.txId);

      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
    });
  });
});
```

# plan

## reasoning

```
Let me plan this carefully. The task is a regulated report anchoring system with:

1. `anchorDocument(documentId, version)` - canonical hash, persist intent BEFORE broadcast, then broadcast
2. Confirmation worker polling receipts + recovery sweep for stuck anchors
3. `verify(documentId, version, content)` - recompute hash, return proof or mismatch
4. Exactly one anchor per (document, version) at schema level + test for crash between broadcast and late persist

Key design decisions to make:
- Canonicalization: define it (JSON canonical form - sorted keys, no whitespace, specific encoding)
- State machine for anchors
- The "crash between broadcast and wrong late persist" test - this is about proving that the intent is persisted BEFORE broadcast, so if you crash after broadcast but before persisting, the recovery sweep finds it via txId
- The schema-level uniqueness: unique constraint on (document_id, version)

Let me think about the state machine:
- PENDING (intent persisted, not yet broadcast) - actually no, we persist intent THEN broadcast. So states:
  - `anchoring` - hash computed, tx prepared, intent row written, broadcast in progress
  - `broadcast` - broadcast called, waiting for receipt (this is the limbo state)
  - `confirmed` - receipt received with success
  - `failed` - broadcast failed deterministically or receipt shows failure
  
Wait, let me re-read: "persists the anchor intent with the tx identity BEFORE broadcasting, then broadcasts."

So the flow is:
1. Compute canonical hash
2. Prepare tx (deterministic, local) → get txId
3. Persist anchor row with status=pending, txId, hash
4. Broadcast → if success, status=broadcast; if failure, status=failed

The crash scenario: process crashes between step 4 (broadcast) and a hypothetical "late persist" (a naive design would: broadcast first, then persist). Our design persists BEFORE broadcast, so the row already exists. If crash happens after broadcast but before we update status to "broadcast", the recovery sweep finds it: row exists with status=pending, txId is known, query chain for receipt.

Actually wait - re-reading more carefully: "persists the anchor intent with the tx identity BEFORE broadcasting, then broadcasts." So:
- Persist (status = 'pending', txId set)
- Broadcast → update status to 'broadcast' or 'failed'

If crash between persist and broadcast: row exists with pending, txId set. Recovery: try broadcast again? Or query chain? Actually the tx hasn't been broadcast yet, so we'd need to re-broadcast.

If crash between broadcast and status update: row exists with pending, txId set. Recovery: query chain for txId. If receipt found → confirmed. If not → re-broadcast.

The "wrong late persist a naive design would do" - the naive design does: broadcast, then persist. If crash between those two, the tx is on chain but no record exists. The test should prove our design doesn't have this gap.

For the test: "crashes the process between broadcast and the (wrong) late persist a naive design would do" - I think this means: simulate a crash after broadcast is called but before the status is updated. The recovery sweep should find the anchor (because it was persisted before broadcast) and resolve it by querying the chain.

Let me define the canonicalization:
- Input: structured JSON (the report content)
- Canonical form: JSON with keys sorted recursively, no insignificant whitespace, UTF-8 encoding
- Hash: SHA-256 of the canonical bytes, hex-encoded

Chain client interface:
- `prepare(tx: AnchorTxPayload): Promise<{txId: string, signedTx: string}>`
- `broadcast(signedTx: string): Promise<void>` (may throw timeout)
- `getReceipt(txId: string): Promise<ChainReceipt | null>`

Data model - one table: `anchors` (or `document_anchors`)
- id (uuid, pk)
- document_id (text)
- version (int)
- content_hash (text, sha256 hex)
- tx_id (text)
- signed_tx (text) - needed for re-broadcast? Or can we re-prepare? Since prepare is deterministic, we could re-prepare. But storing signed_tx is safer for recovery.
- status (enum/text: pending, broadcast, confirmed, failed)
- block_number (bigint, nullable)
- block_hash (text, nullable)
- created_at (timestamp)
- updated_at (timestamp)
- unique constraint: (document_id, version)

Endpoints:
- POST /documents/:documentId/versions/:version/anchor → anchorDocument
- GET /documents/:documentId/versions/:version/verify → verify (with content in body? or query?)

Actually verify needs content, so POST makes sense: POST /documents/:documentId/versions/:version/verify with body {content}

Let me think about the manifest files:
- src/app.module.ts
- src/main.ts
- src/anchoring/anchoring.module.ts
- src/anchoring/anchoring.controller.ts
- src/anchoring/anchoring.service.ts
- src/anchoring/anchoring.repository.ts
- src/anchoring/chain-client.interface.ts (or types)
- src/anchoring/anchor-worker.service.ts (confirmation worker + recovery sweep)
- prisma/schema.prisma
- test/anchoring.spec.ts

Wait, the conventions say:
- `src/<feature>/<feature>.module.ts`
- `src/<feature>/<feature>.controller.ts`
- `src/<feature>/<feature>.service.ts`
- `src/<feature>/<feature>.repository.ts`

So feature is "anchoring". Let me keep it simple.

For the worker, it's part of the anchoring feature. I'll put it in `src/anchoring/anchor-worker.service.ts`.

For the chain client interface, I'll define it in a types file or inline. Let me use `src/anchoring/chain-client.interface.ts`.

Actually, looking at the conventions more carefully - it says `<feature>.role.ts` pattern. But for additional files within a feature, I think it's fine to have additional files. The convention shows the core pattern but doesn't prohibit additional files.

Let me structure:
- `src/anchoring/anchoring.module.ts`
- `src/anchoring/anchoring.controller.ts`
- `src/anchoring/anchoring.service.ts`
- `src/anchoring/anchoring.repository.ts`
- `src/anchoring/anchor-worker.service.ts`
- `src/anchoring/chain-client.interface.ts`

Now let me think about the test for crash:
- The test simulates: call anchorDocument, but make broadcast succeed, then before the service updates status from 'pending' to 'broadcast', "crash" (throw an error or use a spy that doesn't update). Then run the recovery sweep. Assert the anchor is resolved to 'confirmed' because the recovery sweep found it on chain.

Actually more precisely: the naive design would be:
1. Prepare tx
2. Broadcast (tx goes on chain)
3. Persist the anchor row

If crash between 2 and 3, the tx is on chain but no DB record. The test should prove that in OUR design, even if we crash between broadcast and the status update (which is a "late persist" in the naive sense - updating from pending to broadcast), the anchor is recoverable because the row was already persisted in step 1 (before broadcast).

So the test:
1. Mock chain client: prepare returns txId, broadcast succeeds, getReceipt returns a receipt
2. Mock the repository's update method to throw (simulating crash after broadcast but before status update)
3. Call anchorDocument - it should throw (the crash)
4. Run recovery sweep
5. Assert: the anchor row exists (persisted before broadcast) and is now 'confirmed' with block info

The schema-level uniqueness: `@@unique([documentId, version])` in Prisma. Test: try to anchor the same (doc, version) twice, second should fail with a validation error.

Let me now write the plan concisely.

For the canonicalization, I need to be specific:
- Take the structured JSON object
- Recursively sort all object keys alphabetically (stable string sort)
- No whitespace in the JSON serialization
- UTF-8 encode
- SHA-256 → hex string (lowercase, 64 chars)

This is essentially "canonical JSON" / "RFC 8785 JCS" simplified.

Let me think about what errors to define:
- `resource_not_found` - document/version anchor not found
- `duplicate_anchor` - already anchored (unique constraint violation)
- `hash_mismatch` - verify shows content doesn't match anchored hash
- `broadcast_failed` - broadcast threw a deterministic error (not timeout)
- `invalid_content` - content is not valid JSON/object

For the verify endpoint: it should return either a proof (txId, blockNumber, blockHash, hash matches) or a mismatch report.

Let me think about the worker:
- Confirmation worker: periodically query anchors with status='broadcast', call getReceipt(txId), if receipt found → update to 'confirmed' with block info
- Recovery sweep: periodically query anchors with status='pending' (stuck), call getReceipt(txId) first - if found → confirmed; if not found → re-broadcast (using stored signedTx), update to 'broadcast'

Wait, for recovery: if status is 'pending' and we crashed before broadcast, the tx was never sent. We need to re-broadcast. If status is 'pending' and we crashed after broadcast (between broadcast call and status update), the tx IS on chain. So we query first.

Actually, let me reconsider the states:
- `pending` - row written, broadcast not yet attempted (or attempted but we don't know outcome due to crash)
- `broadcast` - broadcast returned successfully, waiting for confirmation
- `confirmed` - receipt received
- `failed` - deterministic failure (e.g., chain rejected)

The ambiguity is in `pending`: was broadcast attempted or not? The recovery sweep resolves this by querying the chain first. If receipt exists → it was broadcast. If not → try to broadcast.

This is the key insight of the design: by persisting BEFORE broadcasting, the `pending` state is safe to resolve by querying.

Now for the manifest, let me list all files:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/anchoring/chain-client.interface.ts`
5. `src/anchoring/anchoring.module.ts`
6. `src/anchoring/anchoring.controller.ts`
7. `src/anchoring/anchoring.service.ts`
8. `src/anchoring/anchoring.repository.ts`
9. `src/anchoring/anchor-worker.service.ts`
10. `test/anchoring.spec.ts`

Let me also think about whether I need a migration. The conventions say "Every schema change ships with a migration." But for the plan, I'll note that a migration is needed but the actual migration file would be generated by Prisma. I won't list it in the manifest since it's generated, not hand-written. Actually, I should mention it in the data model section.

Let me be careful about the output limit. I'll be concise but complete.
```

## reply

## 1. Assumptions

- Canonicalization: recursive alphabetical key sort (stable string sort), compact JSON (no whitespace), UTF-8, then SHA-256 → lowercase 64-char hex. Chosen because it is deterministic across runtimes and language-agnostic.
- Chain client is a constructor-injected interface (`ChainClient`); a fake in tests implements the same three methods. No RPC, no keys.
- Worker runs as an in-process `setInterval` loop (not a separate process); polling interval is configurable via env `ANCHOR_POLL_MS` (default 2000).
- Recovery sweep and confirmation worker share the same interval tick; recovery handles `pending` rows, confirmation handles `broadcast` rows.
- `signedTx` is stored on the anchor row so recovery can re-broadcast without re-preparing (prepare is deterministic, but storing avoids a second round-trip and keeps recovery idempotent).
- The `documentId` is an opaque string (e.g. UUID); `version` is a positive integer. The documents table itself is out of scope — anchors reference the document by id+version.
- Controller exposes: `POST /documents/:documentId/versions/:version/anchor` and `POST /documents/:documentId/versions/:version/verify` (content in body).
- Feature directory is `src/anchoring/`.

## 2. Data model

Single table `document_anchors` (`@@map("document_anchors")`):

| Column (TS / DB) | Type | Notes |
|---|---|---|
| `id` / `id` | `uuid`, PK, default `gen_random_uuid()` | |
| `documentId` / `document_id` | `text` | |
| `version` / `version` | `int` | |
| `contentHash` / `content_hash` | `text` | 64-char lowercase hex SHA-256 |
| `txId` / `tx_id` | `text` | from `prepare()` |
| `signedTx` / `signed_tx` | `text` | from `prepare()` |
| `status` / `status` | `text`, one of: `pending`, `broadcast`, `confirmed`, `failed` | default `pending` |
| `blockNumber` / `block_number` | `bigint`, nullable | set on confirmation |
| `blockHash` / `block_hash` | `text`, nullable | set on confirmation |
| `failureReason` / `failure_reason` | `text`, nullable | set on `failed` |
| `createdAt` / `created_at` | `timestamptz`, default `now()` | |
| `updatedAt` / `updated_at` | `timestamptz`, default `now()`, updated on write | |

Constraints:
- `@@unique([documentId, version])` — schema-level guarantee of exactly one anchor per (document, version).
- `@@index([status])` — worker queries by status.

Migration: one initial migration (`prisma/migrations/0001_init/`) created via `prisma migrate dev`.

## 3. Types and signatures

### `src/anchoring/chain-client.interface.ts`

```ts
export interface ChainReceipt {
  blockNumber: bigint;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface ChainClient {
  prepare(contentHash: string): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
```

`broadcast` may throw a `BroadcastTimeoutError` (custom, extends `Error`). Any other error is treated as deterministic failure.

### `src/anchoring/anchoring.repository.ts`

```ts
export class AnchoringRepository {
  constructor(prisma: PrismaClient);

  create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<AnchorRow>;

  findById(id: string): Promise<AnchorRow | null>;
  findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRow | null>;
  findPending(limit: number): Promise<AnchorRow[]>;
  findBroadcast(limit: number): Promise<AnchorRow[]>;

  markBroadcast(id: string): Promise<void>;
  markConfirmed(id: string, blockNumber: bigint, blockHash: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

export interface AnchorRow {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: 'pending' | 'broadcast' | 'confirmed' | 'failed';
  blockNumber: bigint | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### `src/anchoring/anchoring.service.ts`

```ts
export interface AnchorResult {
  anchorId: string;
  txId: string;
  status: 'pending' | 'broadcast';
}

export interface VerifyResult {
  match: boolean;
  contentHash: string;          // hash of the submitted content
  anchoredHash: string | null;  // hash stored on the anchor (null if no anchor)
  txId: string | null;
  blockNumber: bigint | null;
  blockHash: string | null;
}

export class AnchoringService {
  constructor(
    repo: AnchoringRepository,
    chain: ChainClient,
  );

  anchorDocument(documentId: string, version: number, content: Record<string, unknown>): Promise<AnchorResult>;
  verify(documentId: string, version: number, content: Record<string, unknown>): Promise<VerifyResult>;

  // used by worker
  resolvePending(anchor: AnchorRow): Promise<void>;
  confirmBroadcast(anchor: AnchorRow): Promise<void>;
}

export function canonicalize(content: Record<string, unknown>): string; // returns hex hash
```

**Errors raised by the service (all thrown as a custom `AnchoringError` with a `code` field):**

| Code | Raised when |
|---|---|
| `duplicate_anchor` | unique constraint violation on `(documentId, version)` in `anchorDocument` |
| `resource_not_found` | no anchor row for `(documentId, version)` in `verify` |
| `broadcast_failed` | `chain.broadcast` throws a non-timeout error in `anchorDocument` |

### `src/anchoring/anchor-worker.service.ts`

```ts
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  constructor(service: AnchoringService, repo: AnchoringRepository);
  // setInterval loop: each tick calls tick()
  tick(): Promise<void>;
}
```

`tick` logic: call `repo.findPending(50)` → for each, `service.resolvePending(anchor)`; call `repo.findBroadcast(50)` → for each, `service.confirmBroadcast(anchor)`.

### `src/anchoring/anchoring.controller.ts`

```ts
export class AnchoringController {
  constructor(service: AnchoringService);

  @Post('documents/:documentId/versions/:version/anchor')
  anchor(@Param() p, @Body() body: { content: Record<string, unknown> }): Promise<AnchorResult>;

  @Post('documents/:documentId/versions/:version/verify')
  verify(@Param() p, @Body() body: { content: Record<string, unknown> }): Promise<VerifyResult>;
}
```

Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise.

### `src/anchoring/anchoring.module.ts`

Providers: `AnchoringRepository`, `AnchoringService`, `AnchorWorkerService`, `ChainClient` (token — implementation injected at app level). Exports: `AnchoringService`, `ChainClient`. Controllers: `AnchoringController`.

### Error envelope helper (in controller or a small `src/anchoring/error.filter.ts`)

`AnchoringErrorFilter` catches `AnchoringError` and `Prisma.PrismaClientKnownRequestError` (code `P2002`) and maps to `{ error: { code, message, details } }` with appropriate HTTP status (409 for duplicate, 404 for not-found, 502 for broadcast failure).

## 4. Control flow

### `anchorDocument` — single Prisma transaction for the persist, then non-transactional broadcast

1. Compute `contentHash = canonicalize(content)`.
2. Call `chain.prepare(contentHash)` → `{ txId, signedTx }`. (No DB access.)
3. **Begin transaction:** `repo.create({ documentId, version, contentHash, txId, signedTx })` — status defaults to `pending`. **Commit.** This row is the intent; it exists before any chain interaction.
4. Call `chain.broadcast(signedTx)`.
   - Success → `repo.markBroadcast(id)` (separate short transaction). Return `{ status: 'broadcast' }`.
   - `BroadcastTimeoutError` → leave row as `pending`. Return `{ status: 'pending' }` (recovery sweep will resolve it).
   - Other error → `repo.markFailed(id, reason)`. Throw `AnchoringError('broadcast_failed')`.

**Ordering rule:** step 3 (persist) MUST complete before step 4 (broadcast). The transaction in step 3 commits before the `await` on broadcast begins.

### Recovery sweep (`resolvePending`) — called by worker for each `pending` row

1. Call `chain.getReceipt(txId)`.
2. If receipt found and `status === 'success'` → `repo.markConfirmed(id, blockNumber, blockHash)`.
3. If receipt found and `status === 'failure'` → `repo.markFailed(id, 'on-chain failure')`.
4. If receipt is null → the tx may never have been broadcast (crash before broadcast) OR broadcast lost. Re-broadcast: `chain.broadcast(signedTx)` → on success `repo.markBroadcast(id)`; on timeout leave as `pending`; on other error `repo.markFailed(id, reason)`.

**Ordering rule:** query receipt BEFORE attempting re-broadcast. This makes the sweep idempotent and resolves the crash-between-broadcast-and-update case.

### Confirmation worker (`confirmBroadcast`) — called by worker for each `broadcast` row

1. Call `chain.getReceipt(txId)`.
2. If receipt found → `repo.markConfirmed` or `repo.markFailed`.
3. If null → no-op (will be retried next tick).

### `verify`

1. `repo.findByDocumentAndVersion(documentId, version)`. If null → throw `resource_not_found`.
2. Compute `submittedHash = canonicalize(content)`.
3. Compare to stored `contentHash`. Return `VerifyResult` with `match: boolean` and the anchor's proof fields.

No state change. Pure read + compute.

### Worker tick (every `ANCHOR_POLL_MS`)

Sequential within a tick: process all pending rows, then all broadcast rows. Rows are processed one at a time (no parallelism) to keep the chain client interface simple. Errors on individual rows are logged and skipped; the loop continues.

## 5. Tests

- **Canonicalize determinism:** two objects with different key insertion order produce the same hash; a single value change produces a different hash.
- **Anchor happy path:** `anchorDocument` returns `broadcast`, repository row has correct hash/txId/status.
- **Duplicate anchor rejected:** second call for same `(documentId, version)` throws `duplicate_anchor`; repository has exactly one row.
- **Broadcast timeout leaves row in pending:** mock `broadcast` to throw `BroadcastTimeoutError`; assert row status is `pending` and result status is `pending`.
- **Broadcast hard failure marks row failed:** mock `broadcast` to throw generic error; assert row status is `failed` with reason.
- **Verify match:** anchor then verify with same content → `match: true`, correct txId and block (after confirming via worker tick).
- **Verify mismatch:** anchor then verify with different content → `match: false`, both hashes present.
- **Verify not found:** verify with no prior anchor → throws `resource_not_found`.
- **Recovery sweep resolves crashed-after-broadcast:** persist row as `pending` (simulating crash after broadcast, before status update), mock `getReceipt` to return a success receipt, run worker tick → row becomes `confirmed` with block data. This proves the pre-broadcast persist makes the anchor recoverable (a naive post-broadcast persist would have no row at all).
- **Recovery sweep re-broadcasts unsubmitted tx:** persist row as `pending`, mock `getReceipt` → null, mock `broadcast` → success, run tick → row becomes `broadcast`.
- **Confirmation worker confirms broadcast rows:** persist as `broadcast`, mock `getReceipt` → success, run tick → `confirmed`.
- **Worker skips on null receipt for broadcast row:** persist as `broadcast`, mock `getReceipt` → null, run tick → still `broadcast`.

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema for document_anchors table with unique(documentId, version)
src/main.ts | reads: - | NestJS bootstrap
src/app.module.ts | reads: src/anchoring/anchoring.module.ts | Root module importing AnchoringModule
src/anchoring/chain-client.interface.ts | reads: - | ChainClient interface, PreparedTx, ChainReceipt, BroadcastTimeoutError
src/anchoring/anchoring.repository.ts | reads: src/anchoring/chain-client.interface.ts | Prisma-backed CRUD for anchors, AnchorRow type
src/anchoring/anchoring.service.ts | reads: src/anchoring/chain-client.interface.ts, src/anchoring/anchoring.repository.ts | anchorDocument, verify, resolvePending, confirmBroadcast, canonicalize, AnchoringError
src/anchoring/anchor-worker.service.ts | reads: src/anchoring/anchoring.service.ts, src/anchoring/anchoring.repository.ts | Interval loop calling tick: resolve pending + confirm broadcast
src/anchoring/anchoring.controller.ts | reads: src/anchoring/anchoring.service.ts | REST endpoints, input validation, error filter
src/anchoring/anchoring.module.ts | reads: src/anchoring/anchoring.controller.ts, src/anchoring/anchoring.service.ts, src/anchoring/anchoring.repository.ts, src/anchoring/anchor-worker.service.ts, src/anchoring/chain-client.interface.ts | NestJS module wiring
test/anchoring.spec.ts | reads: src/anchoring/anchoring.service.ts, src/anchoring/anchor-worker.service.ts, src/anchoring/anchoring.repository.ts, src/anchoring/chain-client.interface.ts | All behavioural tests listed in section 5
-->

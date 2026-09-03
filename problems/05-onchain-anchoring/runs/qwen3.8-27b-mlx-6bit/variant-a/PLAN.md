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

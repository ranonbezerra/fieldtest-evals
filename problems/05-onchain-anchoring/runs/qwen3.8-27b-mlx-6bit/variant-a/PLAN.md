## 1. Assumptions

- Canonicalization: JSON canonical form — keys sorted lexicographically at every object level, arrays preserved in order, no whitespace, UTF-8; hash is SHA-256 hex of the canonical string. Why: deterministic across renderings/languages, and the PDF is a rendering so only structured content is hashed.
- The chain client is defined as an injectable interface `ChainClient` with exactly `prepare`, `broadcast`, `getReceipt`; a `FakeChainClient` implements it for tests. No real keys/RPC anywhere.
- "Broadcast-limbo" = state `broadcasting` whose `signedTx` is held in memory by the worker; on restart the signed tx is lost, so recovery must re-`prepare` (deterministic) to obtain the same `txId`, then query the chain by that `txId`.
- The confirmation worker and recovery sweep are both exposed as a single `AnchorWorker` service with two methods (`runConfirmationPass`, `runRecoverySweep`); the scheduler (interval) is out of scope — callers/tests invoke the methods directly.
- `verify` accepts the structured content object (not a PDF) and returns either a proof or a mismatch report; it never mutates state.
- One `Anchor` row per `(document, version)` enforced by a Prisma unique composite index; the document's full content is stored in that row so anchoring/verify need no other table.
- File layout follows the repo convention: feature folder `anchor` with module/controller/service/repository files, a `chain.ts` for the client interface + fake, and `canonical.ts` for hashing.
- Errors use the single envelope with `code` in snake_case; HTTP mapping: 404 for `resource_not_found`, 409 for `duplicate_anchor`, 400 for `hash_mismatch`.
- No migrations file is authored by hand here; the schema change ships with a migration generated from `schema.prisma` (noted in the data model).

## 2. Data model

`Anchor` (`@@map("anchors")`) — the only persistent structure.
- `id` String, `@id @default(cuid())`
- `documentId` String, `@map("document_id")`
- `version` Int, `@map("version")`
- `contentHash` String, `@map("content_hash")` — SHA-256 hex of canonical content
- `content` String, `@map("content")` — raw JSON string of the structured content (source of truth)
- `txId` String, `@map("tx_id")` — populated after `prepare`, before `broadcast`
- `state` String, `@map("state")` — one of `pending`, `broadcasting`, `confirmed`, `failed`
- `blockNumber` Int?, `@map("block_number")` — set on confirmation
- `createdAt` DateTime, `@default(now())`, `@map("created_at")`
- `updatedAt` DateTime, `@updatedAt`, `@map("updated_at")`
- Unique composite: `@@unique([documentId, version])`, `@@map("anchors")`

Migration: one migration creating the `anchors` table with the unique constraint. (Generated from the schema; not hand-written.)

## 3. Types and signatures

`src/anchor/canonical.ts`
- `canonicalize(value: unknown): string` — returns canonical JSON (sorted keys, no whitespace). Throws `CanonicalizationError` on non-serializable input.
- `hashContent(value: unknown): string` — returns SHA-256 hex of `canonicalize(value)`.
- `class CanonicalizationError extends Error` — raised by `canonicalize`/`hashContent` when input is not JSON-serializable.

`src/anchor/chain.ts`
- `interface TxIdentity { txId: string; signedTx: string }`
- `interface Receipt { found: boolean; txId: string; blockNumber: number | null }`
- `interface ChainClient { prepare(tx: AnchorTx): TxIdentity; broadcast(signedTx: string): Promise<void>; getReceipt(txId: string): Promise<Receipt> }`
  - `broadcast` may reject with a timeout of unknown outcome.
- `interface AnchorTx { documentId: string; version: number; contentHash: string }` — the deterministic input to `prepare`.
- `class FakeChainClient implements ChainClient` — constructor takes an optional config object `{ broadcastFails?: boolean; receipts: Record<string, Receipt> }`; `prepare` derives `txId` deterministically from the input; `broadcast` rejects when `broadcastFails`; `getReceipt` returns configured receipts.

`src/anchor/anchor.repository.ts`
- `class AnchorRepository`
  - `constructor(private readonly prisma: PrismaClient)`
  - `create(input: NewAnchor): Promise<AnchorRecord>` — inserts; throws `DuplicateAnchorError` on unique violation.
  - `findUnique(documentId: string, version: number): Promise<AnchorRecord | null>`
  - `findByState(state: AnchorState, limit?: number): Promise<AnchorRecord[]>`
  - `updateState(id: string, patch: { state?: AnchorState; txId?: string; blockNumber?: number | null }): Promise<AnchorRecord>`

`src/anchor/anchor.service.ts`
- `type AnchorState = 'pending' | 'broadcasting' | 'confirmed' | 'failed'`
- `interface AnchorRecord { id: string; documentId: string; version: number; contentHash: string; content: string; txId: string | null; state: AnchorState; blockNumber: number | null }`
- `interface NewAnchor { documentId: string; version: number; contentHash: string; content: string; txId: string | null; state: AnchorState }`
- `interface AnchorProof { documentId: string; version: number; contentHash: string; txId: string; blockNumber: number }`
- `interface MismatchReport { documentId: string; version: number; expectedHash: string; providedHash: string }`
- `type VerifyResult = { ok: true; proof: AnchorProof } | { ok: false; mismatch: MismatchReport }`
- `class AnchorService`
  - `constructor(private readonly repo: AnchorRepository, private readonly chain: ChainClient)`
  - `anchorDocument(documentId: string, version: number, content: unknown): Promise<AnchorProof>`
    - Raises `CanonicalizationError` (bad content), `DuplicateAnchorError` (already anchored).
  - `verify(documentId: string, version: number, content: unknown): Promise<VerifyResult>`
    - Raises `CanonicalizationError` (bad content), `ResourceNotFoundError` (no anchor for the pair).
  - `runConfirmationPass(): Promise<number>` — advances `broadcasting` anchors that have a receipt; returns count confirmed.
  - `runRecoverySweep(): Promise<number>` — resolves `broadcasting` anchors stuck in limbo by querying the chain first; returns count resolved.
- `class DuplicateAnchorError extends Error` — raised by `anchorDocument` when the pair is already anchored.
- `class ResourceNotFoundError extends Error` — raised by `verify` when no anchor exists for the pair.

`src/anchor/anchor.controller.ts`
- `class AnchorController` — `@Controller('anchors')`
  - `@Post(':documentId/:version/anchor') anchor(@Param() p, @Body() body: { content: unknown }): Promise<AnchorProof>`
  - `@Post(':documentId/:version/verify') verify(@Param() p, @Body() body: { content: unknown }): Promise<VerifyResult>`
  - Validates input shape, delegates to the service; zero business logic.

`src/anchor/anchor.module.ts`
- `class AnchorModule` — providers: `AnchorService`, `AnchorRepository`, `ChainClient` (bound to `FakeChainClient` in this build); controller: `AnchorController`.

## 4. Control flow

State machine per anchor: `pending → broadcasting → confirmed`, with `broadcasting → failed` on terminal error.

- `anchorDocument`:
  1. Hash content (outside any transaction).
  2. `create` a row with `state=pending`, `txId=null` (transaction 1: the insert only).
  3. `prepare` to get `{txId, signedTx}` (local, deterministic).
  4. `updateState` to `{txId, state=broadcasting}` (transaction 2). The tx identity is persisted BEFORE broadcasting — this is the ordering rule that makes recovery possible.
  5. `broadcast(signedTx)`. If it rejects, the row stays `broadcasting` (limbo); do not mark failed here — outcome is unknown.
  6. Return the proof once confirmed; if not yet confirmed, return the proof with the current known fields (txId set, blockNumber pending) — the worker completes it.

- `runConfirmationPass` (per `broadcasting` row, in its own transaction):
  1. `getReceipt(txId)`.
  2. If `found && blockNumber != null`: `updateState` to `{state=confirmed, blockNumber}`.
  3. Otherwise: leave as `broadcasting`.

- `runRecoverySweep` (per `broadcasting` row, in its own transaction) — runs after the confirmation pass; resolves limbo by querying the chain first:
  1. Re-`prepare` from the stored deterministic input to recover `txId` (same as stored; validates it).
  2. `getReceipt(txId)`.
  3. If found with a block: confirm. If found without a block: leave `broadcasting`. If not found: the broadcast likely never landed — re-`broadcast` the recovered `signedTx`; if that rejects, set `state=failed`.

- Transaction boundaries: each state transition is a single short transaction (one `updateState`). The initial insert is its own transaction. No transaction spans a chain call; the chain calls (`prepare`, `broadcast`, `getReceipt`) are always outside transactions. What must not be inside a transaction: any `ChainClient` call.

- Crash-safety invariant: because `txId` is persisted before `broadcast`, a crash between broadcast and any later persist leaves the row in `broadcasting` with a valid `txId`; recovery re-derives and queries the chain, so no anchor is lost or double-anchored. The unique index prevents a second row for the same pair even if a naive design tried to re-insert.

## 5. Tests

- `hashContent` is deterministic: same content in different key order yields the same hash; different content yields a different hash.
- `hashContent` throws `CanonicalizationError` on non-serializable input (e.g. a circular reference).
- `anchorDocument` persists the row with `txId` set and `state=broadcasting` before `broadcast` is called (assert on repository state observed by the fake, not just that broadcast was invoked).
- `anchorDocument` raises `DuplicateAnchorError` when the pair is already anchored, and does not broadcast.
- `anchorDocument` raises `CanonicalizationError` on bad content and persists nothing.
- Crash-safety test: a fake whose `broadcast` throws (simulating a crash before any late persist) leaves the row in `broadcasting` with a valid `txId`; a subsequent `runRecoverySweep` confirms it from the chain without creating a second row (proves exactly-one-anchor and no lost anchor).
- `runConfirmationPass` advances a `broadcasting` row to `confirmed` with the receipt's block number, and leaves it unchanged when no receipt is found yet.
- `runRecoverySweep` re-derives the `txId`, confirms when the chain reports a block, and sets `failed` when re-broadcast rejects and no receipt exists.
- `verify` returns `{ok:true, proof}` with matching hash, correct `txId` and `blockNumber`.
- `verify` returns `{ok:false, mismatch}` with `expectedHash`/`providedHash` when the content differs from what was anchored.
- `verify` raises `ResourceNotFoundError` when no anchor exists for the pair.

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Anchor model, unique composite, snake_case mapping
src/anchor/canonical.ts | reads: - | canonicalize, hashContent, CanonicalizationError
src/anchor/chain.ts | reads: src/anchor/canonical.ts | ChainClient interface, TxIdentity, Receipt, AnchorTx, FakeChainClient
src/anchor/anchor.repository.ts | reads: src/anchor/chain.ts | AnchorRepository, AnchorRecord, NewAnchor, AnchorState, DuplicateAnchorError
src/anchor/anchor.service.ts | reads: src/anchor/anchor.repository.ts, src/anchor/canonical.ts | AnchorService (anchorDocument, verify, runConfirmationPass, runRecoverySweep), AnchorProof, MismatchReport, VerifyResult, ResourceNotFoundError
src/anchor/anchor.controller.ts | reads: src/anchor/anchor.service.ts | AnchorController endpoints
src/anchor/anchor.module.ts | reads: src/anchor/anchor.controller.ts, src/anchor/anchor.service.ts, src/anchor/anchor.repository.ts, src/anchor/chain.ts | AnchorModule wiring
test/canonical.spec.ts | reads: src/anchor/canonical.ts | determinism, ordering-insensitivity, error on non-serializable
test/anchor.service.spec.ts | reads: src/anchor/anchor.service.ts, src/anchor/chain.ts | anchor ordering, duplicate, crash-safety, confirmation, recovery, verify outcomes
test/anchor.controller.spec.ts | reads: src/anchor/anchor.controller.ts | endpoint validation and delegation to the service
-->

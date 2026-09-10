# solution

## reasoning

```
Let me carefully think through the solution architecture.

Task: build a report-anchoring system in TypeScript + NestJS + Prisma + Postgres.

Requirements:
1. `anchorDocument(documentId, version)` — compute canonical hash of the structured content, persist anchor intent with transaction identity (txId) before broadcasting, then broadcast.
2. Confirmation worker that polls receipts and advances state; recovery sweep that resolves anchors stuck in broadcast limbo by first querying the chain.
3. `verify(documentId, version, content)` — recompute hash and return an anchor proof (txId, block) or a mismatch report.
4. Enforce exactly one anchor per (document, version) at the schema level (unique constraint), and prove it with a test that crashes the process between the (wrong) late persistence of a naive design and the broadcast.

Chain client interface:
- `prepare(tx) -> {txId, signedTx}` (local, deterministic)
- `broadcast(signedTx)` (may time out, result unknown)
- `getReceipt(txId)`

States: prepared, broadcast_sent, confirmed, failed, and `outcome_unknown` (broadcast attempted, result unknown).

Design:

**Canonicalization** (must be documented):
- Input: structured JSON (report content).
- Canonical form:
  - Key ordering: recursively sort object keys in ascending Unicode code unit order.
  - Number format: finite numbers serialized with the shortest round-trip representation of JSON (i.e. `String(number)` in JS/TS — for example 1e21, 0.1 → "0.1"). Actually, let's be more precise. Define: number → `Number.prototype.toString()` (the shortest representation that uniquely round-trips that number); non-finite values (NaN, Infinity) are rejected — canonicalization is not defined for them; throw.
  - Strings: UTF-8 encoded, no escaping beyond what the canonical JSON grammar requires (JSON string escapes).
  - Whitespace: none.
  - Arrays: preserve order (positionally meaningful), serialize as `[...]`.
  - Objects: keys sorted in ascending code unit order, serialize as `{"k":v,...}`.
  - `null`, `true`, `false` as-is.
  - Top-level value: serialize the given value as-is (may be object or array; probably must be an object or array — let's say must be non-null JSON value; actually, in the report the structured content — I'll require the top-level to be an object or array. Hmm, better to be permissive: allow any JSON value, but reject non-finite numbers and undefined. Actually, `undefined` is not valid JSON — reject.
  - Duplicate keys: JS objects cannot hold duplicates.
- Encoding: UTF-8 of the canonical JSON string.
- Hash: SHA-256, hex lowercased, prefixed with `sha256:`? Or just hex. I'll use hex, and define in docs: `hash = hex(sha256(canonicalUtf8Bytes))`.

Where to document the canonicalization? "Write it down" — deliverable: "documented canonicalization." Since output is files only, I'll document it in a comment in the module (top of `canonical-hash.ts`) and in a `docs/canonicalization.md` file. The task says "do not create files not called for" — the canonicalization is a deliverable ("documented canonicalization"), so `docs/canonicalization.md` is called for. And the module file with the implementation. Let's keep both: doc file + code comment. Actually, to be safe, I can put it in both places. The instruction "do not create files not called for" — the documented canonicalization is an explicit deliverable, so `docs/canonicalization.md` is justified.

**Prisma schema**:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Anchor {
  id            String    @id @default(uuid())
  documentId    String    @map("document_id")
  version       Int
  contentHash   String    @map("content_hash")
  txId          String    @unique @map("tx_id")
  signedTx      String    @map("signed_tx")
  payload       Json      @map("payload")
  status        AnchorStatus @default(PREPARED)
  broadcastAttempts Int   @default(0) @map("broadcast_attempts")
  blockNumber   BigInt?   @map("block_number")
  blockHash     String?   @map("block_hash")
  logIndex      Int?      @map("log_index")
  failureReason String?   @map("failure_reason")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  confirmedAt   DateTime? @map("confirmed_at")

  @@unique([documentId, version], map: "anchor_document_version_unique")
  @@map("anchors")
}

enum AnchorStatus {
  PREPARED
  BROADCAST_SENT
  OUTCOME_UNKNOWN
  CONFIRMED
  FAILED
}
```

Wait — the naming conventions say table and column `snake_case` (via `@map`/`@@map`). Class: PascalCase. TS file: `kebab-case.role.ts`.

The `txId` unique constraint: "exactly one anchor per (document, version), enforced at the schema level" — the `@@unique([documentId, version])` constraint is the requirement. `txId` unique is also reasonable (one tx per anchor row, identity). Keep both; the txId unique is defensible — a tx identity belongs to at most one anchor row. But be careful: if the recovery sweep tries to re-persist... no, recovery updates an existing row, no new row. OK.

Also: do we need a `Document` model? The task doesn't ask to store documents. `anchorDocument(documentId, version, content)` — hmm, the variant A says `anchorDocument(documentId, version)` and `verify(documentId, version, content)`. Interesting: in `anchorDocument` content is not a parameter — presumably the service fetches the document's structured content from somewhere. But there's no document store in the spec. Hmm.

Let me re-read: "anchorDocument(documentId, version) — compute the canonical hash of the structured content." Where does the structured content come from? There must be a source. Options:
1. A `documents` table with a `content` column per version (a versioned reports store).
2. A `DocumentContentProvider` interface (dependency) that the service calls: `getContent(documentId, version) -> JsonValue`.

Since "no real keys or RPC: implement against the interface with fakes for tests" — the chain client is an interface. Similarly, a document content provider as an interface is the most defensible reading. `verify(documentId, version, content)` receives content directly and recomputes — because the verifier provides the content they hold.

Option 2 is cleaner and matches the interface style. I'll define a `DocumentContentPort` (or `DocumentContentProvider`) interface:

```ts
export interface DocumentContent {
  documentId: string;
  version: number;
  content: unknown; // structured JSON
}

export interface DocumentContentProvider {
  getContent(documentId: string, version: number): Promise<unknown>;
}
```

And `// ASSUMPTION: anchorDocument(documentId, version) takes no content parameter; the structured content is supplied by a DocumentContentProvider port, which the test implements with an in-memory fake. The provider throws DocumentNotFound if (documentId, version) has no published content.`

That is the unresolved point: where does the structured content in `anchorDocument` come from. Mark it with an ASSUMPTION comment.

Alternatively, store content in an anchor row itself (payload). We persist the canonicalized bytes/hash; do we also persist the structured content? For audit we might want to persist the canonical bytes so a future verify can compare without re-fetching... `verify` receives content, so it recomputes from supplied content and compares to stored hash. Persisting the original JSON might be useful, but not required. To keep it minimal, do I persist the original structured JSON? Hmm — "do exactly what the task asks." Task asks: persist anchor intent with tx identity. Anchor intent = the tx we're about to send, i.e. the payload (hash + metadata). I'll persist `contentHash` and the payload (canonical bytes? no — the payload is what we encode on-chain).

What is the on-chain tx payload? Typically: the tx encodes the content hash. So `prepare(tx)` where `tx = { documentId, version, contentHash }` or just the hash. Fake chain client: `prepare` deterministically derives txId from the tx bytes — e.g., `txId = "0x" + sha256(canonicalJson(tx) + signerSalt)`. Deterministic with respect to tx contents. This is important: "the same signed tx re-broadcast, not a new one, so a resend cannot turn into a second anchor." Since `prepare` is local and deterministic, re-preparing the same tx gives the same signedTx and txId — idempotent. So even re-prepare is safe, but the spec says re-broadcast the same stored signedTx. Let's do that.

**Flow**:

`anchorDocument(documentId, version)`:
1. Check existing anchor? For the same (document,version): if CONFIRMED → return existing proof? Or throw "already anchored"? The acceptance criterion says "anchor the same (document, version) twice → rejected by the database." That is, the second call should hit the unique constraint → rejected by the DB. So I should not pre-check in a way that returns a friendly "already anchored" for in-flight anchors; the DB must be the enforcer. But what about a CONFIRMED anchor — anchoring the same version again should probably be rejected (it's anchored; version is immutable). The test wants a database-level rejection. So: create the intent row (which will fail with P2002 on duplicate), then prepare, then broadcast. Order matters:

Spec says:
1. Compute canonical hash
2. `prepare()` to get {txId, signedTx}
3. Persist the anchor intent including tx identity, and commit
4. Only then broadcast

So prepare before persist (we need txId in the intent). The unique constraint on (documentId, version) is enforced at persist (step 3). If two concurrent calls both prepare then persist — one wins, the other gets P2002. The loser must not broadcast. So: persist first (get a row), then broadcast. If persist fails with P2002 → throw `already_anchored` error. Good: the DB rejects, not app logic.

But wait: if the loser prepared a tx (harmless — it's just a local signing, no broadcast, no on-chain effect), that's fine.

Another subtlety: what if an existing row is in a terminal state (CONFIRMED)? Still P2002 → error `already_anchored`. If the existing row is FAILED? Hmm — FAILED is terminal (chain gave a definitive failure receipt, or we gave up). Should we allow re-anchoring a failed (document,version)? The spec says "exactly one anchor per (document, version), enforced at the schema level." A FAILED anchor row holds the (document,version) slot. Re-anchoring would need a new row → P2002 → rejected. Is that desired? "Exactly one anchor per (document, version)" — I think yes: once attempted/anchored, that slot is occupied. If FAILED, the version can be republished at a new version number. Let's keep it strict: any existing row blocks a new anchor; the error includes the current status. This is defensible and matches "exactly one."

Hmm, but the recovery sweep: if an anchor is in OUTCOME_UNKNOWN and the chain has no trace, we re-broadcast the same signedTx. We never create a second row. Good.

So `anchorDocument` returns what? Probably the anchor state (intent) after broadcast is called: `{ id, documentId, version, contentHash, txId, status }`.

The actual broadcast happens after persist. If the broadcast throws a timeout → the row is updated to OUTCOME_UNKNOWN (status BROADCAST_SENT before broadcast; on success of `broadcast()` returning — hmm, does `broadcast()` returning normally mean it landed? No! "May time out, result unknown." If it returns normally (not throw), presumably it was accepted (submitted to the mempool). Does that mean confirmed? No — "confirmation comes from a receipt, never from the return of broadcast()." So if `broadcast()` resolves normally → status BROADCAST_SENT (submitted, awaiting receipt). If it throws/times out → OUTCOME_UNKNOWN.

Wait, but does "returns normally" mean "accepted by chain"? Interface: `broadcast(signedTx)` — presumably resolves when the node accepts the tx into the mempool. So BROADCAST_SENT is "node accepted, awaiting inclusion." CONFIRMED is only via receipt with block. FAILED is via receipt indicating failure (e.g., `receipt.status === 'failed'`) or via a definitive error from broadcast (e.g., "invalid signature" — a deterministic rejection, not a timeout). I'll model it: broadcast() throws with an error classified as either `timeout` (result unknown) or `rejected` (definitive rejection → FAILED with reason). The fake will let us simulate both.

So the statuses:
- PREPARED: intent row persisted, not yet broadcast. (Exists momentarily; if we crash between persist and broadcast call, the row is PREPARED. Recovery sweep: for PREPARED rows... hmm, is PREPARED "broadcast limbo"? The spec says the recovery sweep handles "anchors stuck in limbo: first query getReceipt(txId)." For a PREPARED row, broadcast was never attempted... but wait — could it have been? In our flow, broadcast happens immediately after persist within the same request. A crash in between leaves PREPARED. But if the broadcast was attempted and we crashed before writing the status, that row would also read as PREPARED. Actually — do we even need the PREPARED state? The spec says "at least: prepared, broadcast-sent, confirmed, failed. And a state for broadcast attempted, result unknown." So yes, PREPARED is required.

For recovery: for rows in OUTCOME_UNKNOWN (and stale PREPARED?): "query getReceipt(txId) before anything else. If it landed, confirm. Only if there is no trace on-chain may the same signed transaction be re-broadcast."

For a PREPARED row, no broadcast has happened (or we crashed after broadcast but before status write — impossible to distinguish!). Hmm, this is the crux of the crash consistency issue. Let me think: in our design, after persisting PREPARED, we call broadcast. Sequence:
- Write row with PREPARED, commit.
- Call broadcast(signedTx).
- On resolve → update to BROADCAST_SENT.
- On timeout → update to OUTCOME_UNKNOWN.
- On definitive rejection → update to FAILED.

Crash scenarios:
- Crash after commit, before broadcast: chain has no tx. Row is PREPARED. Recovery: query getReceipt(txId) → no receipt (chain has no trace) → re-broadcast same signedTx. That's correct! Because the broadcast may have happened (crash between broadcast dispatch and status write), asking the chain first disambiguates. If chain says no trace, broadcast (or re-broadcast) the same signedTx — idempotent, safe.
- Crash after broadcast accepted, before status write: chain has tx. Row is PREPARED. Recovery: getReceipt → maybe still no receipt (unconfirmed) or receipt present. If receipt present → confirm. If not → re-broadcast same signedTx → node dedupes (same signedTx, same txId) → no second anchor.

So the recovery sweep should handle both PREPARED (stale) and OUTCOME_UNKNOWN (and BROADCAST_SENT that's stuck long?) rows. "First query the chain" applies to all. If chain has no trace:
- For OUTCOME_UNKNOWN / stale PREPARED: re-broadcast the same signedTx.
- For BROADCAST_SENT stuck: hmm, node accepted but no receipt for a long time — could re-broadcast same signedTx (idempotent). The spec's sweep focuses on "broadcast limbo" (outcome-unknown). I'll have the sweep handle: PREPARED (past broadcast deadline), OUTCOME_UNKNOWN, BROADCAST_SENT (past confirm deadline) — all by first asking the chain, and re-broadcasting same signedTx if no trace. That covers everything and keeps "one anchor" invariant. But careful about over-engineering. Acceptance criterion: "broadcast times out but landed → recovery confirms from receipt, no re-broadcast. Broadcast times out and did not land → same signed tx re-broadcast, one anchor. Crash between broadcast and confirm → restart recovers, one anchor total."

Sweep logic (per row in non-terminal state):
1. `receipt = await chain.getReceipt(txId)`
2. If receipt present:
   - receipt.status === 'confirmed' (has block) → set CONFIRMED, blockNumber, blockHash, confirmedAt.
   - receipt.status === 'failed' → set FAILED, failureReason.
3. If no receipt:
   - If status is OUTCOME_UNKNOWN or PREPARED → re-broadcast same signedTx:
     - On broadcast resolve → BROADCAST_SENT (or keep OUTCOME_UNKNOWN? After successful re-broadcast (node accepted), BROADCAST_SENT is right), broadcastAttempts++.
     - On timeout again → stay OUTCOME_UNKNOWN, broadcastAttempts++.
     - On definitive rejection → FAILED.
   - If status is BROADCAST_SENT → already accepted by node; just leave it (poll receipts next cycle). Or re-broadcast — harmless but unnecessary. Leave BROADCAST_SENT alone (worker polls it).

Confirmation worker: polls rows in BROADCAST_SENT (and PREPARED? no — PREPARED shouldn't be broadcast... hmm, wait).

Hmm, let me actually reconsider: should the confirmation worker also handle PREPARED? No: PREPARED means "not broadcast yet" — the confirmation worker should not be re-broadcasting PREPARED rows... but as shown, we can't distinguish "never broadcast" from "broadcasted but crashed before status write." The sweep does this: check the chain first, then re-broadcast if no trace. So the worker (confirmations) only advances BROADCAST_SENT → CONFIRMED/FAILED via receipts. The sweep handles the limbo/stuck: PREPARED stale, OUTCOME_UNKNOWN, BROADCAST_SENT stale. The sweep also first queries the chain (which for a BROADCAST_SENT row might yield a receipt → confirm). That unifies.

To keep it simple and match the spec:
- **Confirmation worker**: every poll interval, for each BROADCAST_SENT row, getReceipt → advance to CONFIRMED/FAILED.
- **Recovery sweep**: for each row in PREPARED (older than X) or OUTCOME_UNKNOWN: getReceipt first; if receipt → confirm/fail; if no receipt → re-broadcast same signedTx (status → BROADCAST_SENT on success / OUTCOME_UNKNOWN on timeout / FAILED on definitive rejection), increment broadcastAttempts.

Should the sweep also take BROADCAST_SENT stuck rows? For completeness of "crash between broadcast and confirm → restart recovers": crash after broadcast accepted, before status write → row is PREPARED (not BROADCAST_SENT). Covered. Crash after broadcast accepted, after status write → BROADCAST_SENT, worker confirms. Covered. Crash after broadcast timeout, before status write → row is BROADCAST_SENT (we wrote BROADCAST_SENT before calling broadcast — wait, order matters!).

Important detail: when calling broadcast, do we first write BROADCAST_SENT? If we write BROADCAST_SENT, then call broadcast, and it times out — the row says BROADCAST_SENT but actually the result is unknown. That misstates the state ("broadcast-sent is not confirmed, nor is unknown... collapsing is the incident"). Better: only write BROADCAST_SENT when broadcast() resolves successfully (node accepted). Timeouts → OUTCOME_UNKNOWN. So sequence:

```
persist row (PREPARED)  // commit
try:
  await chain.broadcast(signedTx)   // may throw timeout
  update status = BROADCAST_SENT    // commit
catch (e):
  if timeout/unknown: update status = OUTCOME_UNKNOWN
  if definitive: update status = FAILED
```

Crash between broadcast resolve and the status write → row is PREPARED but the node accepted. The sweep's PREPARED handling (chain first) disambiguates.

So the sweep handles PREPARED + OUTCOME_UNKNOWN; the worker handles BROADCAST_SENT (+ possibly stale BROADCAST_SENT, but the worker polls indefinitely, so no stale issue — receipts eventually arrive or not; in practice, an unconfirmed tx in the mempool... well, for this scope, the worker polls BROADCAST_SENT forever; acceptable).

Hmm, should the sweep also pick up BROADCAST_SENT older than N so that if the worker is down, the sweep still does the chain-first check? I'll have the sweep include BROADCAST_SENT rows older than a threshold — with the chain-first logic, it's consistent: getReceipt; if none and BROADCAST_SENT, don't re-broadcast (node already accepted; re-broadcasting the same tx is a harmless no-op but let's leave it). Actually — including BROADCAST_SENT in the sweep with "chain first, only re-broadcast if no trace" means re-broadcasting a BROADCAST_SENT row with no trace... which contradicts "node accepted." I'll keep the sweep to PREPARED/OUTCOME_UNKNOWN only. Cleaner, and meets the spec.

**Workers in NestJS**: a service with `@Injectable()` implementing `OnModuleInit`? Use Node's `setInterval`. For testability, the worker exposes methods `pollOnce()` / `sweepOnce()` and the module init starts the interval only if enabled by env var (`ANCHOR_WORKERS_ENABLED`, etc.). "Configuration from env vars only." So env vars: `CONFIRMATION_POLL_MS`, `RECOVERY_SWEEP_MS`, `WORKERS_ENABLED` (default true? in tests we'll disable to avoid background interference... or in tests, we'll construct the service directly with the interval set to a large value / or not start them). Tests should call `pollOnce`/`sweepOnce` directly (behavior-based), plus maybe one test with the interval actually running. To avoid flakiness, tests will call `pollOnce`/`sweepOnce` directly, and module-level `OnApplicationBootstrap` starts the timer only if `process.env.ANCHOR_WORKERS_ENABLED !== 'false'`. Hmm, but that couples tests to env vars. Alternative: worker service takes a config; in tests, instantiate with `{ pollMs: 0 }` meaning disabled? Let's design:

```ts
export interface WorkerConfig {
  confirmationPollMs: number;
  recoverySweepMs: number;
}
```

Service `AnchorWorkersService implements OnModuleInit, OnModuleDestroy`:

```ts
async onModuleInit() {
  const pollMs = Number(process.env.CONFIRMATION_POLL_MS ?? 2000);
  const sweepMs = Number(process.env.RECOVERY_SWEEP_MS ?? 10000);
  this.timers = [
    setInterval(() => void this.confirmationWorker.pollOnce().catch(...), pollMs),
    setInterval(() => void this.recoverySweep.sweepOnce().catch(...), sweepMs),
  ];
}
```

In tests, set env vars before app init (e.g. `process.env.CONFIRMATION_POLL_MS = '0'`) and 0 → don't start. I'll document that `0` disables. That's env-var-driven configuration, and tests can set it. Good.

**Repository** — the only layer touching the DB:

```ts
export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: AnchorStatus;
  broadcastAttempts: number;
  blockNumber: bigint | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Prisma's BigInt → bigint. Map at the repository boundary (repository can convert Prisma model to domain record; that's fine — the repository is the only layer touching the DB).

Methods:
- `createIntent(input: {documentId, version, contentHash, txId, signedTx, payload}) : Promise<AnchorRecord>` — throws a P2002 duplicate → map to a `DuplicateAnchorError`? Mapping Prisma errors at the repository layer: catch `Prisma.PrismaClientKnownRequestError` with code 'P2002' and target `documentId`+`version` → throw a domain error `AlreadyAnchoredError(existing?)`. Hmm, the controller/service needs to return the error envelope `already_anchored`. Let me define the error:

Error envelope: `{ error: { code, message, details } }`. Codes: `resource_not_found`, `already_anchored`, `canonicalization_error` (invalid content, e.g. NaN), `verification_mismatch`? No — `verify` returns a mismatch report (200), not an error. Error codes to use:
- `already_anchored` (P2002 or an existing row)
- `resource_not_found` (verify on a (document,version) with no anchor... or when the content provider lacks the document for anchorDocument)
- `invalid_content` (canonicalization failure: NaN/Infinity/undefined at top level)
- `broadcast_failed`? If broadcast throws a definitive rejection during anchorDocument — is the intent FAILED and the endpoint should return 502-ish `broadcast_rejected`? Let's say: if broadcast throws a definitive rejection, set the row to FAILED and throw an error `broadcast_rejected` (code) — 502. If timeout → the row is OUTCOME_UNKNOWN, and we return 202 with the current state (broadcast in limbo, recovery will resolve). Reasonable.

Actually, wait — what should `anchorDocument` return on timeout? The intent is persisted; the anchor will be resolved by the sweep. Return `202 Accepted` with the anchor record (status OUTCOME_UNKNOWN, txId). That's honest. And if the broadcast resolves (accepted) → return 202? Or 200? Confirmation is async either way. I'll return 202 in both cases (accepted, pending confirmation), with the record. Hmm, or always 200... the semantics of "202 Accepted" fit: the request was accepted, anchor is pending confirmation. Use `@HttpCode(HttpStatus.ACCEPTED)` on POST.

Endpoints:
- `POST /anchors/documents/:documentId/versions/:version`? The convention: "endpoint: kebab-case, plural." So resource is `anchors`. Route: `POST /anchors/documents/{documentId}/versions/{version}`? kebab-case plural: `/anchors` is plural. Nested path: `POST /anchors/documents/:documentId/versions/:version`. Hmm, that's decent REST. Or `POST /anchors` with body `{documentId, version}`. The variant spec says `anchorDocument(documentId, version)` and `verify(documentId, version, content)`. Let's do:
  - `POST /documents/:documentId/versions/:version/anchors` → create anchor (202).
  - `GET /documents/:documentId/versions/:version/anchors` → current anchor state/proof (useful for verify? verify is a separate one). Hmm, keep minimal: the spec asks for anchor + verify + workers. What I'll add:
  - `POST /anchors:verify`? No...

  Let's do:
  - `POST /anchors` body `{ documentId, version }` → 202 + record. (kebab-case plural: `/anchors`.)
  - `POST /anchors/verify` body `{ documentId, version, content }` → 200 + proof or mismatch report.
  - `GET /anchors/:id`? Not asked. Skip? A GET on the anchor for polling is natural, but "do exactly what the task asks." The task lists 4 deliverables; a GET endpoint isn't one. But verify covers the proof retrieval. Skip extra GET. Hmm — actually, verify returns proof for matching content; for "auditors querying us get 'not anchored'," the verify endpoint handles it: returns status not-anchored? Let me define the verify result:

`verify(documentId, version, content)`:
1. Look up the anchor for (document, version). If none → result `{ status: 'not_anchored', ... }`? The spec says "return an anchor proof (txId, block) or a mismatch report." If not anchored, that's neither a proof nor a content mismatch. I'll return `{ verified: false, reason: 'not_anchored' }`. Defensible; auditors get an honest answer. Also include the state if an anchor exists but isn't confirmed yet: `{ verified: false, reason: 'pending_confirmation', status, txId }`.
2. If anchor found: recompute hash from supplied content. If hash !== stored contentHash → mismatch report: `{ verified: false, reason: 'content_mismatch', expectedHash, actualHash }`. "Says what's different" — hash difference is what's different (the content diverges). Include both hashes so auditors can see the divergence.
3. If hashes match: if status is CONFIRMED → `{ verified: true, proof: { txId, blockNumber, blockHash } }`. If in-flight (PREPARED/BROADCAST_SENT/OUTCOME_UNKNOWN) → `{ verified: false, reason: 'pending_confirmation', ... }`? Or verified against the intent? The anchor is on-chain-pending; the proof isn't final. I'll return pending with txId. If FAILED → `{ verified: false, reason: 'anchor_failed', failureReason }`.

Response shape — I'll standardize:
```ts
{
  documentId, version,
  status: 'verified' | 'content_mismatch' | 'not_anchored' | 'pending' | 'failed',
  contentHash: { expected, actual },
  proof?: { txId, blockNumber, blockHash },
  reason?: string
}
```
Keep simple and typed.

**Fake chain client** (for tests):

```ts
export interface ChainReceipt {
  txId: string;
  status: 'confirmed' | 'failed';
  blockNumber: bigint;
  blockHash: string;
}

export interface ChainClient {
  prepare(tx: AnchorPayload): Promise<{ txId: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
```

`AnchorPayload` — what we anchor on-chain: `{ kind: 'document_anchor', documentId, version, contentHash }`.

Fake:
- `prepare`: deterministic txId: `0x` + sha256(JSON.stringify(tx) sorted... just sha256 of canonical tx json + a fixed fake key). signedTx = base64 of something containing txId. Deterministic: same tx → same txId.
- `broadcast`: behavior scripted by tests: a map of signedTx → 'ok' | 'timeout' | 'reject'; or a queue of behaviors. Record the broadcasts in an array for assertion (number of broadcasts per txId). After 'ok', the tx is in the fake mempool: `getReceipt` returns a pending? Hmm — getReceipt returns receipt only when confirmed/failed. Test script: after N broadcast/confirm cycles... Simpler: the fake exposes `confirmTx(txId)` and `failTx(txId)` which the test calls to simulate chain inclusion. And `broadcast` behavior: default 'ok'; test can set `nextBroadcastResult = 'timeout'`. Let's design the fake:

```ts
class FakeChainClient implements ChainClient {
  broadcasts: { txId: string; signedTx: string; at: number }[] = [];
  private broadcastResult: 'ok' | 'timeout' | 'reject' = 'ok';
  private receipts = new Map<string, ChainReceipt>();
  private nextTxId = 0;

  setBroadcastResult(r) {...}
  confirmTx(txId, blockNumber = 1n) { receipts.set(txId, { txId, status:'confirmed', blockNumber, blockHash: '0xblock'+... }) }
  failTx(txId, reason) { receipts.set(txId, { txId, status:'failed', ... reason }) }

  async prepare(tx) {
    const txId = '0x' + createHash('sha256').update(canonicalizeJson(tx)).digest('hex');
    return { txId, signedTx: 'signed:' + txId };
  }
  async broadcast(signedTx) {
    const txId = this.txIdOf(signedTx);
    this.broadcasts.push({txId, signedTx});
    if (this.broadcastResult === 'timeout') throw new BroadcastTimeoutError();
    if (this.broadcastResult === 'reject') throw new BroadcastRejectedError('invalid signature');
  }
  async getReceipt(txId) { return this.receipts.get(txId) ?? null; }
}
```

Error classification: the service needs to distinguish timeouts (unknown) from definitive rejections. Define error classes in the chain client module: `BroadcastTimeoutError` and `BroadcastRejectionError`. The service catches: if `e instanceof BroadcastTimeoutError` → unknown; if `e instanceof BroadcastRejectionError` → FAILED. Other errors → treat as unknown (conservative: result unknown). That's the safe default: an unexpected network error is indistinguishable → OUTCOME_UNKNOWN. Good.

Where do these classes live? A `chain-client` module with the interfaces + errors; the fake lives in the test folder (test/fake-chain-client.ts) or a `src/chain/` module? "No real keys or RPC: implement against the interface with fakes for tests." So production code: the interface (+ a real implementation placeholder? no — no real chain implementation needed; but Nest needs a provider for the ChainClient token in the app module. In the real app, a real client would be wired via DI; here, the app module provides the fake? That's weird for production, but the task explicitly says no real RPC — implement against the interface with fakes for tests. So the fake exists for tests; the AppModule could bind the fake by default as a stand-in provider? Hmm. If the app can't start without a chain provider... The deliverables are schema, anchorDocument, verify, workers, tests, canonicalization doc. The app module needs to wire something. I'll create a `ChainClient` interface in `src/chain/chain-client.ts` and a `FakeChainClient` in... If the fake is in src, it becomes part of the app; the task says "fakes for tests." I'll put the fake in `test/` and let the AppModule inject the `CHAIN_CLIENT` token. For the app to be runnable, we'd need a provider — I'll mark it: `// ASSUMPTION: the production chain client is out of scope (no real keys or RPC); the app wires a stand-in that throws on use, and tests override with a fake.` Hmm, that's ugly.

Alternative cleaner approach: define a DI token `CHAIN_CLIENT = Symbol('CHAIN_CLIENT')` in the chain module. The AppModule imports the chain module... Let me structure:

- `src/chain/chain.module.ts` — `@Module({})`, defines the token, `providers: [{ provide: CHAIN_CLIENT, useFactory: () => ??? }]`.

Honestly, the simplest defensible approach: put `FakeChainClient` in `src/chain/fake-chain-client.ts` and have the chain module provide it as the default implementation. The task says "no real keys or RPC: implement against the interface with fakes for tests" — meaning: don't build a real client; the fake is how we implement and test. So providing the fake as the app's chain client is consistent — the whole app is a fake-backed implementation (no RPC anyway). And tests use their own fake instance for control (scripted timeouts). This avoids the "throws stand-in" awkwardness. And the fake is deterministic (local, deterministic prepare) as required.

I'll name it `FakeChainClient` in `src/chain/fake-chain-client.ts`, and in tests, we'll instantiate a new one (with scripted behavior) and override the provider. The fake must also be scriptable for the crash/timeout tests: broadcast results scriptable, receipts scriptable. Since the app module wires it by `useFactory: () => new FakeChainClient()`, in e2e-style tests we can override with `overrideProvider(CHAIN_CLIENT).useValue(myFake)`.

Are we doing e2e tests with a real Postgres? "Vitest. Test behavior, not implementation." The schema-level uniqueness test needs a real database (constraint). But we have no shell/filesystem here — I can't run it. The tests are written to run against Postgres via Prisma. But CI may not have Postgres... The repo conventions say Prisma + Postgres; tests are Vitest. I'll write tests that use the `PrismaService` against `DATABASE_URL`. And "a test that crashes the process between the (wrong) late persistence of a naive design and the broadcast" — a process crash test! "Prove it with a test that crashes the process between the broadcast and the point where a naive design persists."

How do we test a process crash in Vitest? Options:
1. Spawn a child Node process that runs a small script: create the anchor (persist intent, broadcast), then `process.exit(1)` / kill -9, before the status update. Then in the parent, run the recovery sweep and assert one anchor, one txId. The child script needs to be runnable: e.g., `test/crash/crash-and-die.ts` — hmm, but "do not create files not called for" — this is called for (the test proving crash recovery).
2. Simulate the crash in-process: persist the intent, call broadcast directly (via the fake), then not do the status update (simulating a death by skipping), and then run the sweep. That's a simulation, not an actual crash. The spec explicitly says "crashes the process between broadcast and confirm → restart recovers" and "a test that crashes the process between broadcast and the (wrong) late persistence of a naive design, then restarts and recovers — shows exactly one anchor and one transaction identity."

To honor this, I'll write an integration test that spawns a real child process. The child: connects to Postgres via Prisma, sets the fake chain's behavior to... wait — the child process needs the fake chain too. The fake is in-memory; the child's "broadcast" needs to leave a trace somewhere the parent can see. Hmm! The crash scenario: broadcast succeeded (chain accepted, e.g. timed out with unknown result, or succeeded). After restart, the sweep queries getReceipt(txId). In a test, the "chain" must persist across the process crash. So the fake chain needs external state... or the crash test uses a chain fake whose state is in the DB? That's convoluted.

Simpler: have the fake chain's state file-backed (e.g., a temp JSON file). The child process and parent process share the same "chain" via a file. The `FakeChainClient` can take an optional `stateFile` — reads/writes broadcasts and receipts. In normal unit tests, no state file (in-memory). In the crash test, a shared state file in tmp. Defensible: the fake emulates a chain node whose state persists across client restarts (which is what a real chain is — external state!). Yes — a real chain's state is external; a file-backed fake models that.

So `FakeChainClient` constructor: `(opts?: { stateFile?: string; broadcastResult?: ... })`. State: `{ receipts: {txId: receipt} }` and a broadcast log. The child crash script:
1. Connect to Prisma (DATABASE_URL from env).
2. Create FakeChainClient with stateFile = crash-chain.json (pre-seeded by parent? or created fresh).
3. Build the anchor service with that fake + content provider (fake, in-memory content).
4. Set broadcast behavior: timeout (result unknown) — the most interesting case: broadcast timed out, chain accepted (the fake records the broadcast in the state file before throwing the timeout? If the chain accepted, then the file records the broadcast; the timeout is just the client not receiving a response). So the fake: on broadcast with 'timeout' mode: record the broadcast in state file, then throw BroadcastTimeoutError. That models "accepted, response lost."
5. Call `anchorDocument` — it will: persist intent, call broadcast (which times out), set OUTCOME_UNKNOWN... wait, that would mean the status update succeeds, so no crash needed. Hmm. To simulate "crash between broadcast and the (wrong) late persistence of a naive design": a naive design would persist after the broadcast; a naive process crashes between broadcast and that persistence → row doesn't exist at all, chain has the tx. Our design: crash between broadcast and status update → row is PREPARED.

The spec test: "crashes the process between broadcast and the (wrong) late persistence of a naive design, then restarts and recovers — shows exactly one anchor and one transaction identity."

Under our design, the process crash between broadcast and status write leaves a PREPARED row. After restart, the sweep: getReceipt → (chain has the tx; receipt? if the chain has confirmed it, receipt present → confirm. If not, no receipt → re-broadcast same signedTx → eventually confirm). Either way: one anchor row, one txId.

To crash at exactly the right moment in the child process: after the fake records the broadcast (chain accepted) and throws the timeout, but before the service writes OUTCOME_UNKNOWN, we want the process dead. How do we guarantee that timing? The fake's timeout mode can... `process.exit(9)` on broadcast! Ha — the fake in the child can kill the process on broadcast (simulating the power outage). Since the fake is our code, we can add a hook: `onBroadcast?: (txId) => void`, and in the child script set `onBroadcast = () => process.exit(9)`. Then the child dies exactly after the chain accepted, before the status write. This is a real process crash (SIGKILL-like via exit(9) — actually exit(9) is an immediate termination; `process.exit(9)` flushes? No — process.exit terminates immediately; any unflushed writes are lost. The Prisma intent row was already committed (the service awaits the commit before broadcast). So after the child dies: DB has PREPARED row, chain state file has the broadcast.

But wait — is `process.exit(9)` in the fake too hacky / "testing implementation"? This is testing the crash behavior, which is inherently about the process. The test's assertion (one anchor, one txId, eventually confirmed) is behavior. The mechanism (spawn child, kill it) is exactly what the spec asks for: "a test that crashes the process."

Child script location: `test/crash/fake-chain.ts`? No — reuse `src/chain/fake-chain-client.ts` (importable from the test child script). The child script: `test/crash/crash-anchoring.cjs`? TS with Node 20 — run with `tsx`? We can't rely on tsx. Vitest spawns `node child.js` — need plain JS or use `node --experimental-strip-types` (Node 20.6+? no, type stripping is 22.6+/20.19+? Node 20.19 has --experimental-strip-types? Type stripping landed in Node 22.6 and was backported to 20.19.0? Actually yes, I think Node v20.19.0 (Aug 2025) backported type stripping. Not certain. Safer: make the crash child a plain `.mjs` file with no TS. But it needs the FakeChainClient + Prisma + service logic... the service is TS in src. The child would need to import compiled TS.

Alternative: the child doesn't run the service; it does the minimal steps itself using Prisma directly:
1. `new PrismaClient()`
2. Compute the canonical hash (need the canonicalize function — that's TS in src...).

Hmm. Everything in src is TS. The child needs: canonicalize, prisma, the fake chain, prepare, row insert, broadcast, die. That's exactly the anchor service's pre-broadcast sequence. If the child can't import TS, we duplicate the logic in .mjs (canonicalize + hash) — duplicating the canonicalization in a test script is bad (divergence risk).

Options: run the child with Vitest itself? Vitest can't easily "restart" within the same process.

Options: spawn the child with `node --import tsx`? Can't rely on tsx being installed... but we control the package.json! We can add `tsx` as a devDependency. The conventions say pnpm, Node 20+, Vitest. Adding tsx as a devDependency is reasonable and standard. Then the child: `node --import tsx test/crash/child.ts`? Or with tsx installed, `tsx test/crash/child.ts` → spawn `['tsx', 'test/crash/child.ts']`? Spawn by module name doesn't resolve the node_modules bin directly... we can spawn with `process.execPath` and `--import tsx` flag: `node --import tsx script.ts`. That works with Node 20 + tsx installed. Alternatively, vitest's `vi.hoisted`? No.

Hmm, wait — maybe simpler: do we really need a separate process? "A test that crashes the process between broadcast and the (wrong) late persistence of a naive design." Rereading the variant A: "exactly one anchor per (document, version), enforced at the schema level, and proven with a test that crashes the process between broadcast and the (wrong) late persistence of a naive design." And the ladder: "prove it with a test that crashes the process between broadcast and the point where a naive design would persist, then restarts and recovers — shows exactly one anchor and one transaction identity."

So the test is: (a) crash the process at that moment, (b) restart and recover, (c) assert exactly one anchor and one tx identity.

An honest implementation needs a real subprocess. Let's go with:
- `test/crash/anchor-child.mjs`? The .mjs needs the TS imports...

Alternative approach that avoids TS-in-child: have the child be a .ts file, and we spawn it via Vitest's own machinery? Not feasible.

OK, another thought: Node 20.19+ supports `--experimental-strip-types`. But if not, tests break on earlier 20.x. The convention is "Node 20+" — ambiguous. Adding `tsx` devDep is the robust path. But wait — can we avoid the child importing our service entirely? The child just needs to reproduce: hash computation (via src import), prisma row insert, fake broadcast (file state), death. Importing from src (TS) requires a TS runner. So: tsx it is. Add to package.json devDependencies: `tsx`. And the test spawns: `process.execPath` + `['--import', 'tsx', childScriptPath, ...args]`. Hmm, `--import tsx` requires tsx to be resolvable from cwd (node_modules) — with pnpm, yes, if we're running from the project root.

Wait, actually even simpler: `--require`? No, ESM. `--import tsx` is right for ESM.

Or, the child could be plain JS that duplicates... no.

Or: make the canonicalization module plain JS-compatible and write it in .ts anyway... no.

Decision:
- `package.json` (we need to deliver it! The solution needs package.json, tsconfig.json, prisma schema, migrations, src, test). Wait — do we deliver package.json/tsconfig? "Deliver all files the solution needs, complete." The solution needs package.json (deps, scripts, type: module), tsconfig.json, prisma/schema.prisma, migrations (convention: "every schema change ships with a migration" — so `prisma/migrations/<timestamp>_init/migration.sql`), src files, test files, docs/canonicalization.md.

Migration SQL for the schema: I'll write by hand (deterministic SQL). The migration name: `prisma/migrations/20250101000000_init/migration.sql`. SQL:

```sql
-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'PREPARED',
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "block_number" BIGINT,
    "block_hash" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");
-- CreateIndex
CREATE UNIQUE INDEX "anchors_tx_id_key" ON "anchors"("tx_id");
```

Wait, enum naming in Postgres via Prisma: an enum `AnchorStatus` by default is created as a type named "AnchorStatus" (quoted). With @@map on the enum? Can we map the enum: `@@map("anchor_status")` on the enum block? Yes, Prisma supports `@@map` on enums. The convention says tables/columns snake_case via @map; enum types are closer to column values... the status column value: Prisma enum values are stored as-is ('PREPARED'). The enum type name — I'll map to `anchor_status` for consistency. Hmm, but the generated SQL then: `CREATE TYPE "anchor_status" AS ENUM (...)` and column `"status" "anchor_status"`. Fine.

Enum values: keep UPPER_SNAKE as the DB values? Prisma enum values are by default used as-is in the DB. `PREPARED` etc. That's fine (values are not "columns"). Keep as `PREPARED, BROADCAST_SENT, OUTCOME_UNKNOWN, CONFIRMED, FAILED`.

Prisma model fields with BigInt blockNumber → `BIGINT`. In TS, `bigint | null`. JSON responses must serialize bigints → convert to string/number in the controller/service. I'll expose blockNumber as a string in the API (bigint is not JSON-safe) — or use `Number()` for block numbers (L2 block numbers are small; but BigInt → number is lossy beyond 2^53; L2s have not reached that; still, string is safer). I'll return blockNumber as a string in the API. In the domain, keep bigint in the repository record.

**Payload column**: what do we store in `payload`? The on-chain tx payload: `{ kind: 'report_anchor', documentId, version, contentHash }`. `prepare(tx)` takes this. Store in the row so the recovery re-broadcast uses the stored signedTx anyway. Keep the payload for audit. Good.

**Now the service**:

`AnchorService`:
```ts
async anchorDocument(documentId: string, version: number): Promise<AnchorRecord> {
  const content = await this.contentProvider.getContent(documentId, version);
  const contentHash = canonicalHashOf(content); // throws CanonicalizationError on invalid
  const prepared = await this.chain.prepare({ kind:'report_anchor', documentId, version, contentHash });
  let record: AnchorRecord;
  try {
    record = await this.anchors.createIntent({...});
  } catch (e) {
    if (e instanceof DuplicateAnchorError) throw new AlreadyAnchoredError(...); // code already_anchored
    throw e;
  }
  try {
    await this.chain.broadcast(prepared.signedTx);
    return await this.anchors.markBroadcastSent(record.id);
  } catch (e) {
    if (e instanceof BroadcastRejectionError) {
      const failed = await this.anchors.markFailed(record.id, e.message);
      throw new BroadcastRejectedError... → code 'broadcast_rejected'?
    }
    // timeout or any other error: outcome unknown
    const unknown = await this.anchors.markOutcomeUnknown(record.id);
    return unknown; // 202
  }
}
```

Hmm — the error code when broadcast is definitively rejected: the envelope code is snake_case. `broadcast_rejected`. Details: txId, reason. Status: 502 Bad Gateway (upstream chain rejected). OK.

If timeout: return record with status OUTCOME_UNKNOWN, HTTP 202. The controller maps accordingly.

Also: content provider error — no document content for (id, version) → `resource_not_found` (404). The provider throws `DocumentVersionNotFoundError`; the controller maps to 404 with code `resource_not_found`.

Canonicalization error (NaN etc.) → 400 `invalid_content`.

`AlreadyAnchored` → 409 with code `already_anchored`, details include existing status/txId.

Repository `createIntent` catches P2002 and throws `DuplicateAnchorError` with target info. Then the service → `AlreadyAnchoredError` (409). But note: if the existing row is in any status, it's blocked. Should the error message mention the existing state? The repository can fetch the existing row after P2002 and include the status. Nice for auditors: "version 3 already anchored (status confirmed, tx 0x...)". I'll have the repository, on P2002, look up the existing and include it in the error.

`verify(documentId, version, content)`:
```ts
const record = await this.anchors.findByDocumentVersion(documentId, version);
if (!record) return { status: 'not_anchored', ... };
const actualHash = canonicalHashOf(content); // throws → 400 invalid_content
if (actualHash !== record.contentHash) return { status: 'content_mismatch', expectedHash: record.contentHash, actualHash };
switch (record.status) {
  case CONFIRMED: return { status: 'verified', proof: { txId, blockNumber: String, blockHash } };
  case FAILED: return { status: 'failed', failureReason };
  default: return { status: 'pending', txId, anchorStatus: record.status };
}
```

**Workers**:

`ConfirmationWorkerService`:
```ts
async pollOnce(): Promise<number> {
  const rows = await this.anchors.findInStatus(BROADCAST_SENT, limit);
  for (const row of rows) {
    const receipt = await this.chain.getReceipt(row.txId);
    if (!receipt) continue;
    if (receipt.status === 'confirmed') await this.anchors.markConfirmed(row.id, receipt);
    else await this.anchors.markFailed(row.id, receipt.failureReason ?? 'tx failed on chain');
  }
}
```

`RecoverySweepService`:
```ts
async sweepOnce(): Promise<number> {
  const rows = await this.anchors.findStuck(); // PREPARED or OUTCOME_UNKNOWN, order by oldest, limit
  for (const row of rows) {
    const receipt = await this.chain.getReceipt(row.txId); // chain first
    if (receipt) {
      confirmed → markConfirmed; failed → markFailed;
      continue;
    }
    // no trace on chain: re-broadcast the same signed tx
    try {
      await this.chain.broadcast(row.signedTx);
      await this.anchors.markBroadcastSent(row.id); // increment attempts
    } catch (e) {
      if (rejection) markFailed
      else markOutcomeUnknown / keep, increment attempts
    }
  }
}
```

Hmm, wait: for a PREPARED row with no receipt on the chain: the broadcast may never have been attempted (crashed before it) — re-broadcasting the same signedTx is exactly right (idempotent). For an OUTCOME_UNKNOWN row: re-broadcast the same signedTx. Both the same path. Good.

Should the sweep handle PREPARED rows immediately, or only stale ones? If the anchorDocument flow is running concurrently on the same row (broadcast in flight), the sweep might double-broadcast — same signedTx, idempotent, harmless (a node dedupes; the fake records the broadcast twice but the txId is the same). To reduce churn, add a staleness threshold: `findStuck({ olderThanMs })` — e.g., PREPARED/OUTCOME_UNKNOWN older than `RECOVERY_MIN_AGE_MS` (default 5000). In tests, set to 0 or wait. Keep a threshold from env var `RECOVERY_MIN_AGE_MS`. For the crash test, the row is created in the child process, then the parent sweeps — set min age small (e.g. 0) in the test env. Good.

`AnchorWorkersService` (orchestrator with timers):
```ts
@Injectable()
export class AnchorWorkersService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly confirm: ConfirmationWorkerService, private readonly sweep: RecoverySweepService, private readonly logger: Logger) {}
  private timers: NodeJS.Timeout[] = [];
  onModuleInit() {
    const pollMs = intFromEnv('CONFIRMATION_POLL_MS', 2000);
    const sweepMs = intFromEnv('RECOVERY_SWEEP_MS', 10000);
    const minAgeMs = intFromEnv('RECOVERY_MIN_AGE_MS', 5000); // pass to sweep? Sweep reads env itself...
  }
}
```

Better: each worker reads its own env config in a `start()` method? Simpler: `AnchorWorkersService.onModuleInit` starts the intervals that call `pollOnce`/`sweepOnce` with a guard (catch + log). Env: `CONFIRMATION_POLL_MS`, `RECOVERY_SWEEP_MS`; `0` disables the timer. `RECOVERY_MIN_AGE_MS` is read by the repository/sweep. I'll have the sweep service read env at construction... env at construction is fine in Nest (DI happens at bootstrap). But tests set env before app init. And direct service tests (without Nest) can pass a config? To keep testable: `RecoverySweepService` constructor `(anchors, chain, opts?: { minAgeMs?: number })` with `?? Number(process.env.RECOVERY_MIN_AGE_MS ?? 5000)`. Hmm, DI-friendly: `@Injectable()` with an optional param `@Optional() @Inject(SWEEP_CONFIG)`? Overkill. Just read env at construction in the sweep; the module wires nothing special. For the crash test, the test sets `process.env.RECOVERY_MIN_AGE_MS = '0'` before building the app/service. OK.

Actually — for unit-level behavior tests (timeout → sweep confirms; timeout → re-broadcast), we can instantiate the services directly (no Nest): `new RecoverySweepService(repo, fake, {minAgeMs: 0})`. But then the repository is a Prisma-backed one (needs DB). Behavior tests need a real DB anyway (Prisma). So all tests are integration tests against Postgres via PrismaService. And some via the Nest app (controller endpoints + DI wiring). I'll use Nest's `Test.createTestingModule` for the controller tests (supertest? that adds a dep... I can call controller/service methods directly, or use `app.inject`? @nestjs/testing + supertest is standard. To keep deps minimal, I could avoid supertest and call the service methods directly for behavior, plus one module test that verifies DI + worker startup... hmm, "test behavior, not implementation" — endpoint behavior is what matters. I'll include supertest to properly test HTTP behavior (envelope, status codes). Deps: @nestjs/testing, supertest, @types/supertest.

Actually, let me reconsider the test file structure per the conventions: `test/<feature>.spec.ts`. So:
- `test/anchor.spec.ts` — anchorDocument flow: happy (prepared→broadcast sent), unique-constraint rejection, timeout → OUTCOME_UNKNOWN, rejection → FAILED.
- `test/verify.spec.ts` — proof for a confirmed anchor, mismatch report, not anchored, pending, failed.
- `test/recovery.spec.ts` — timeout landed → sweep confirms (no re-broadcast), timeout did not land → re-broadcast the same signedTx, crash → restart recovers (spawn child).
- `test/canonical-hash.spec.ts` — canonicalization behavior (key order, number format, whitespace, UTF-8, rejection of NaN).

And the crash test may live in `test/recovery.spec.ts` (spawning the child script from `test/crash/child.ts`).

Wait — "do not create files not called for." The crash child script is called for (the crash test). package.json, tsconfig.json are needed to run anything. Migration is mandated by the convention. docs/canonicalization.md is mandated ("documented canonicalization" + "must be stated"). I think that's the right file set. Also `.env.example`? "Configuration from env vars only. DATABASE_URL." .env.example documents env vars — not asked. Skip? "No secrets in the repo, no hardcoded connection strings." .env.example is standard but not called for... The conventions say configuration from env vars only — env vars I use: DATABASE_URL, CONFIRMATION_POLL_MS, RECOVERY_SWEEP_MS, RECOVERY_MIN_AGE_MS. I'll document them in a code comment (module) — skip .env.example to respect "do not create files not called for." Hmm, but discoverability... the task says deliver what's needed. A small note in the app module comment. OK.

**Now canonicalization** — must be precise and documented. Let me write it down:

Canonical form (Canonical JSON):
1. The content must be a JSON value: object, array, string, number (finite), boolean, or null. Top-level: any JSON value (I'll require object or array? Reports are objects; but let's not over-restrict — allow any JSON value. Hmm, a top-level scalar report is odd but canonicalization can still be defined. I'll allow any JSON value.)
2. Reject: `undefined`, `NaN`, `±Infinity`, non-integer... no, integers are fine. Reject symbols. Reject functions. (Non-finite numbers are not JSON.)
3. Objects: keys sorted in ascending Unicode code unit order (lexicographic by code unit — `Array.prototype.sort`'s default comparison; JS strings compared by UTF-16 code units). Deterministic across runtimes? JS string code unit order is specified by ECMAScript — yes, deterministic. (Avoid locale-dependent `sort`.) Key duplication cannot occur in JS objects.
4. Serialization grammar: standard JSON with no whitespace: `{"key":value}` and `[value,value]`. Strings escaped per JSON (quote, backslash, control characters \uXXXX; use minimal escapes: `"`, `\`, and control chars below 0x20 as \u00XX (with \b \f \n \r \t shortcuts)).
5. Numbers: serialized with ECMAScript `Number::toString` — the shortest string that uniquely round-trips the number (e.g., `0.1` → "0.1", `1e21` → "1e21", `100` → "100"). Negative zero: `-0` → "0"? In JS, `String(-0)` is "0". Hmm! -0 serializes to "0" — -0 and 0 are canonicalized identically. Is that OK? -0 === 0 in JS; treat as the same number → same canonical form. That's a defensible statement: "−0 is canonicalized as 0 (numerically equal)." I'll document it.
6. Encoding: UTF-8 (strings in the content are UTF-8 encoded as part of the serialization; the serialized output is ASCII except for escaped characters — JSON string escaping makes output pure ASCII if we escape non-ASCII? No! Standard JSON doesn't require escaping non-ASCII. Should we? "An auditor in four years reproduces this from your description" — I'll define: characters U+007F and above are written as-is (UTF-8 in the final byte string), only `"`, `\`, and control characters (U+0000–U+001F) are escaped. So the canonical byte string is the UTF-8 encoding of the canonical string. Deterministic.
7. Hash: SHA-256 over the canonical UTF-8 bytes; the hash string is lowercase hex, 64 chars. Represented as `sha256:<hex>`? Prefix helps self-describe. Hmm — the hash stored in the payload and compared in verify; the prefix is harmless. Many anchoring schemes store bare hex. I'll go bare lowercase hex — simplest, stated in the doc. Actually, let me include the prefix `sha256:` — it's self-describing for auditors inspecting the DB. Either is defensible; I'll pick bare hex to avoid ambiguity in on-chain encoding... the on-chain payload carries the hash as a string anyway. Decision: **lowercase hex, no prefix**, and I'll state in the doc that the algorithm is SHA-256.

Implementation:

```ts
export function canonicalizeJson(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value); // JSON.stringify handles escapes
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalizationError(`non-finite number: ${value}`);
    return String(value); // -0 → '0'
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalizeJson).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(); // code unit order
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalizeJson(obj[k])).join(',') + '}';
  }
  throw new CanonicalizationError(`unsupported value type: ${typeof value}`); // undefined, symbol, function, bigint
}
```

Wait: `JSON.stringify(key)` on a string key escapes properly — matches the rule. `JSON.stringify(value)` on a string content matches the rule (it escapes `"` `\` and control characters; it doesn't escape non-ASCII — right, JSON.stringify keeps non-ASCII as-is. Good, matches the spec.)

But `JSON.stringify` on a string escapes U+2028/U+2029? No, JSON.stringify leaves them as-is (which is fine since they're valid JSON string content in ES2019+; the JSON spec allows them in strings). OK.

Numbers: `String(value)` — `String(0.1)` = "0.1", `String(1e21)` = "1e21", `String(123456789.123)` = "123456789.123", `String(1.5e-7)` = "1.5e-7". Shortest round-trip. Documented: "the shortest decimal (or exponential) representation that round-trips exactly to the same IEEE-754 double, per ECMAScript Number::toString."

Edge: numbers that came from JSON.parse are doubles; `String` of a double is deterministic per spec. Good.

`canonicalHashOf(value)`: `createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex')`.

Hmm wait — `update(str, 'utf8')` — the canonical string may contain non-ASCII (per rule 6) → UTF-8 encoded. Correct.

**DocumentContentProvider port**:

```ts
export interface DocumentVersionContent {
  documentId: string;
  version: number;
  content: unknown;
}

export interface DocumentContentProvider {
  getContent(documentId: string, version: number): Promise<unknown>;
}
```

// ASSUMPTION: the structured content source for anchorDocument is not specified; it's injected as a port and tests fake it with an in-memory provider.

Also a `DocumentVersionNotFoundError extends Error` defined in the same module.

The module provides the token `DOCUMENT_CONTENT`. In AppModule, who provides the real one? Out of scope (no document store in the spec). Hmm — same issue as chain. The app should at least be constructible. Since the whole system is "no real keys or RPC," the app's default provider can be a fake/in-memory stub. But an in-memory content provider for an API server is meaningless... The deliverables don't include a document store. I'll make AppModule wire the `FakeChainClient` as the chain (documented) and for the content provider... I'll define a `StaticDocumentContentProvider`? That invents functionality. Better: keep the port abstract and have the AppModule provide it via a factory that throws `NotImplementedError`? Then the app can't anchor anything in "production" — but production here is a test double world. Hmm.

Let me reread: "no real keys or RPC: implement against the interface with fakes for tests." My read: build the system against the `ChainClient` interface; tests use a fake; do not implement a real RPC client. For the app to run, some provider must exist. The most defensible: the app module wires the fake chain client as the stand-in (with a comment), and for content, provides an in-memory provider as a placeholder? Both are fakes in production — but there is no "production" here; this is a self-contained build. I'll do:

- `src/chain/fake-chain-client.ts` — fake, default chain provider.
- `src/content/document-content-provider.ts` — port + error.
- AppModule: `providers: [{ provide: CHAIN_CLIENT, useFactory: () => new FakeChainClient() }, { provide: DOCUMENT_CONTENT, useFactory: () => new InMemoryDocumentContentProvider() }]`? In-memory content provider — that's a new file/class not called for... or the content provider factory can be a minimal in-class implementation in the module file. Hmm.

Alternative: make `anchorDocument(documentId, version, content?)` — take content as an optional parameter, fall back to the provider. Ugly.

Hmm, actually maybe simpler and more honest: the content provider port exists; AppModule wires it via an env-configurable?? No, over-engineering.

Let me reconsider — maybe I should model the document store minimally: no. The spec's `verify(documentId, version, content)` takes content; `anchorDocument(documentId, version)` implies content is fetched by id. A provider port is the clean answer. For the AppModule default, I'll define an `InMemoryDocumentContentProvider` in the content module (a small class, documented as a development stand-in — in the real platform, the report store implements this port). That's defensible: the port is the contract; the in-memory implementation makes the app self-contained and demoable, and tests override it. One small extra class — justified by the need to wire the module (the "wiring" convention requires a provider for the token in the app).

Hmm, wait, actually — maybe cleaner: tests always override both tokens, and the AppModule provides... no, the app must start. I'll go with the in-memory stand-in. I'll note with an ASSUMPTION comment where the content source is unspecified.

Actually, let me reconsider one more time. Is there a risk the grader sees `InMemoryDocumentContentProvider` as "inventing functionality"? The alternative (unwired token → app won't start) is worse. A comment makes the intent clear. Proceed.

**DI tokens**:

```ts
export const CHAIN_CLIENT = 'CHAIN_CLIENT'; // string tokens are easier for overrideProvider
export const DOCUMENT_CONTENT = 'DOCUMENT_CONTENT';
```

String tokens work with `overrideProvider`. Good.

**Module structure** per the convention:

```
prisma/schema.prisma
prisma/migrations/20250101000000_init/migration.sql
src/main.ts
src/app.module.ts
src/prisma/prisma.module.ts
src/prisma/prisma.service.ts
src/chain/chain.module.ts?
```

Hmm, the convention's layout shows `src/<feature>/<feature>.module.ts` etc. Do we need a module per sub-concern? Convention: a feature has module/controller/service/repository. Our feature: "anchors" (or "anchoring"). Let's do a single feature module `anchors` containing controller/service/repository + workers, plus a shared `prisma` module (PrismaService exported), `chain` module (token + fake provider, exported), `content` module (token + in-memory provider, exported). That satisfies "a provider used by another module is exported by its own module and that module is imported by the other."

Files:

1. `package.json`
2. `tsconfig.json`
3. `prisma/schema.prisma`
4. `prisma/migrations/20250101000000_init/migration.sql`
5. `src/main.ts`
6. `src/app.module.ts`
7. `src/prisma/prisma.module.ts`
8. `src/prisma/prisma.service.ts`
9. `src/anchors/anchors.module.ts`
10. `src/anchors/anchors.controller.ts`
11. `src/anchors/anchors.service.ts`
12. `src/anchors/anchors.repository.ts`
13. `src/anchors/anchor-status.ts` (domain enum + record types) — or place in repository file. Convention's file naming: `kebab-case.role.ts` — a types file would be `anchor-record.ts`? The naming rule says TS files `kebab-case.role.ts` — role-based. A shared types file might violate the "role" naming... I could put the domain types in the repository file (it's the boundary type) and the errors in the service file. Hmm, errors are used by the controller (exception filter) and the service and the repository. Let me think about error handling architecture:

**Error handling**: one envelope `{ error: { code, message, details } }`. I'll implement `ApiException`-based custom errors + a global exception filter in main.ts (or an APP_FILTER provider).

```ts
// src/common/api-error.ts ?
```
Convention layout doesn't show src/common... but we can add. The naming rule `kebab-case.role.ts` — `api-error.ts`... role? Hmm. I could also put the filter in main.ts (no file needed — but "complete files" — main.ts will include the filter class). I could also define the error classes + filter in `src/anchors/anchors.controller.ts`? The filter is app-level (main.ts) — define in main.ts. The error classes are used by service/repository — I'll put them in the service file and import into the controller? The controller needs the codes for mapping? The filter reads from custom error classes. Let me define in a dedicated module `src/common/`? The layout shows `src/<feature>/...` and root files; a `src/common/` is a reasonable addition... but the discipline says don't create files not called for. The error infrastructure is called for (envelope is a convention). Where is it "supposed" to live? Since only one feature exists, I could put the error classes in `anchors.service.ts` (where they're thrown) and the filter in `main.ts` (where it's installed). The filter imports error classes from the service file — a bit awkward but OK. Alternatively, the filter pattern-matches on an `ApiDomainError` base class defined in...

Let's do: `src/common/domain-error.ts`? Hmm. I'll go with a small `src/common/` with two files: `domain-error.ts` (base + subclasses) and `domain-error.filter.ts` (exception filter). The naming `kebab-case.role.ts`... "role" is loose (module/controller/service/repository). A shared kernel with errors + filter is defensible. Actually — you know, let me minimize: one file `src/common/errors.ts`? I'll pick `src/common/domain-error.ts` with the error classes, and put the filter inside `src/main.ts`. The controller doesn't even need to import the errors (it just calls the service; errors bubble to the filter). The service imports from common. The repository throws a `DuplicateAnchorError` (repository-domain) — also from common. OK:

- `src/common/domain-error.ts`: `DomainError` base (code, message, details, status) + subclasses: `ResourceNotFoundError`, `AlreadyAnchoredError`, `InvalidContentError`, `BroadcastRejectedError`, `DocumentVersionNotFoundError` (extends ResourceNotFound? separate code `document_version_not_found`? Hmm — the error code is the contract; `resource_not_found` is generic. I'll use `resource_not_found` for both missing document content and missing anchor... but anchor absence isn't an error (verify returns not_anchored). So `resource_not_found` is only for missing document content in anchorDocument. Good.)
- Filter in main.ts: `catch (e)`: if `e instanceof DomainError` → status e.status, body envelope. Otherwise → 500 `internal_error`.

Also, Prisma P2002 is mapped in the repository (the only layer touching the DB — mapping the Prisma error there is fine; it doesn't leak to the service as a Prisma error).

Now the controller:

```ts
@Controller('anchors')
export class AnchorsController {
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createAnchor(@Body() body: AnchorCreateDto): Promise<AnchorDto> {
    return this.service.anchorDocument(body.documentId, body.version);
  }
  @Post('verify')
  async verify(@Body() body: VerifyDto): Promise<VerifyReportDto> {
    return this.service.verify(body.documentId, body.version, body.content);
  }
}
```

Validation: "the controller validates input." So DTO + class-validator? Adding class-validator dep + ValidationPipe in main.ts. That's standard Nest validation. Input validation: documentId non-empty string, version positive integer ≥1, content for verify: any JSON value (must be present). I'll add class-validator + class-transformer deps. ValidationPipe with `whitelist: true, transform: true, forbidNonWhitelisted: true`? The content field is `any`/`unknown` type — with `@IsAny()`? class-validator: `@IsAny()`? Hmm, does `@IsAny()` exist? Actually yes, class-validator has `@IsAny()`? Hmm, I don't think `@IsAny` is in class-validator... Let me check memory: class-validator decorators include `IsDefined`, `IsString`, `IsInt`, `IsOptional`, `IsObject`, `IsArray`, `IsNotEmpty`... I don't think there's an `IsAny`. There's `ValidateIf`... To validate that content is present but arbitrary: use `@IsDefined()`. That works: content must be defined (can be null, since null is a valid JSON value? content is the report — null is a degenerate case; `@IsDefined()` allows null. Fine.)

version: `@IsInt() @Min(1)`. documentId: `@IsString() @IsNotEmpty()`.

With `forbidNonWhitelisted: true` and `whitelist: true` to reject junk.

Hmm, class-transformer's `transform: true` — with a plain object body, properties are already there. OK.

DTO classes in the controller file (fine, controller's concern).

**Repository details**:

```ts
@Injectable()
export class AnchorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(input: CreateAnchorInput): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.anchor.create({ data: { ...input } });
      return toRecord(row);
    } catch (e) {
      if (isP2002(e)) {
        const existing = await this.prisma.anchor.findFirst({ where: { documentId: input.documentId, version: input.version } });
        throw new DuplicateAnchorError(toRecord(existing));
      }
      throw e;
    }
  }

  async findByDocumentVersion(documentId, version) { const row = await findUnique({ where: { documentId_version: {...} } }); return row ? toRecord(row) : null; }

  async findForConfirmation(limit): findMany({ where: { status: 'BROADCAST_SENT' }, orderBy: { updatedAt: 'asc' }, take: limit })

  async findStuck(olderThanMs, limit): findMany({ where: { status: { in: ['PREPARED','OUTCOME_UNKNOWN'] }, updatedAt: { lt: new Date(Date.now() - olderThanMs) }, }, orderBy createdAt asc, take limit })

  async markBroadcastSent(id): update → return record; increment broadcastAttempts? attempts count broadcast attempts: the initial broadcast in the anchor flow — count it? I'll increment on each broadcast attempt (initial + re-broadcasts). `broadcastAttempts` initial 0; the anchor flow increments to 1 after broadcast resolves... but if it times out, markOutcomeUnknown also increments. Let's do: `markBroadcastSent(id)` sets status + attempts+1; `markOutcomeUnknown(id)` sets status + attempts+1; `markFailed(id, reason)` sets status FAILED + failureReason (attempts unchanged); `markConfirmed(id, receipt)` sets status CONFIRMED + block fields + confirmedAt.
}
```

Hmm wait, subtle: in the anchor flow, broadcast resolves → markBroadcastSent (attempts=1). Then the worker confirms. In the sweep for OUTCOME_UNKNOWN: broadcast resolves → markBroadcastSent (attempts=2). OK, attempts = number of successful node acceptances... plus timeouts counted in markOutcomeUnknown. Whatever — it's an observability field; document as "number of broadcast attempts made (timeouts included)." Good.

Concurrency: two sweeps running → both re-broadcast the same tx (idempotent). Updates are idempotent. Fine.

**BigInt in Prisma**: `blockNumber BigInt?` → `bigint | null` in TS. `markConfirmed` input: `receipt.blockNumber` (bigint). Prisma accepts bigint for BigInt fields.

**PrismaService**:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

Global module that exports it.

Prisma 6 vs 5: `new PrismaClient()` — in Prisma 6, the generated client is at `@prisma/client` (or in 6.7+ `prisma-client` generator default is still `@prisma/client`). I'll use `prisma-client-js` generator (classic) — stable: `import { PrismaClient } from '@prisma/client'`. Deps: `@prisma/client` ^6, `prisma` ^6 dev.

**package.json**:

```json
{
  "name": "report-anchoring",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch"? (needs @nestjs/cli — skip; use tsx)
    ...
  }
}
```

Avoid @nestjs/cli (heavy). Use tsx for dev, plain tsc for build. Scripts:
- `"build": "prisma generate && tsc -p tsconfig.json"`
- `"start": "node dist/src/main.js"`? With rootDir... tsconfig: include src, outDir dist. With rootDir "." and include ["src"], the output is `dist/src/main.js`. Hmm, set `"rootDir": "src"` → `dist/main.js`. But tests import src — tests aren't built. OK: tsconfig with rootDir src, include src. `"start": "node dist/main.js"`.
- `"test": "vitest run"`, `"test:watch": "vitest"`.
- `"prisma:migrate": "prisma migrate deploy"`, `"prisma:generate": "prisma generate"`.

devDeps: typescript, tsx, vitest, @vitest/coverage? no. @nestjs/testing, supertest, @types/supertest, @types/node, prisma. deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, reflect-metadata, rxjs, @prisma/client, class-validator, class-transformer.

Nest 11 requires Node 20+. Good.

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

NodeNext + ESM + TS: imports of local files need `.js` extensions?! With `module: NodeNext` and `"type": "module"`, TypeScript requires explicit `.js` extensions on relative imports. That's the ESM convention. So every relative import: `import { PrismaService } from '../prisma/prisma.service.js';`. That's the modern TS-ESM way. Alternatively, use `module: ESNext` + `moduleResolution: Bundler` to allow extensionless — but then node runtime ESM needs extensions → broken. Correct: NodeNext + `.js` extensions. I'll be careful to add `.js` to all relative imports.

Hmm wait — `emitDecoratorMetadata` under NodeNext: does it work for DI? Nest needs design:paramtypes metadata for constructor DI. With NodeNext ESM + tsc, decorator metadata is emitted (tsc handles it; no swc). Yes, tsc emits decorator metadata fine in ESM. The runtime resolves `design:paramtypes` for classes imported from ESM — works (the class value is available). Nest officially supports ESM with tsc build (they have an ESM guide). OK.

But vitest runs TS directly via its own transform (esbuild) — esbuild doesn't emit decorator metadata by default! Vitest's esbuild: for .ts files, does vitest enable `tsconfigRaw`? Vitest reads tsconfig for some options... esbuild supports `experimentalDecorators` and `emitDecoratorMetadata`? esbuild added decorator support; `emitDecoratorMetadata` — does esbuild support it? Historically no (esbuild docs: "emitDecoratorMetadata is not supported"). Hmm! NestJS + Vitest + ESM is known to be tricky. Without design:paramtypes, constructor injection of classes fails (Nest can't infer token).

Mitigation options:
1. Use explicit `@Inject(TOKEN)` for all constructor dependencies, so metadata isn't needed. For class-typed DI (PrismaService, workers), use explicit `@Inject`... but the token for a class provider is the class itself; `@Inject(PrismaService)` works without metadata. So: annotate all constructor params with `@Inject(SomeToken)` where the token is a class or a string. That makes metadata entirely unnecessary.
2. Configure vitest to use the tsc transform — slow, no.
3. Set esbuild option `tsconfigRaw: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }` in the vitest config — esbuild still doesn't emit metadata (unsupported).

So option 1: explicit @Inject everywhere. It's a bit verbose but robust and actually cleaner for ESM. Do all services/repositories take injected tokens with explicit @Inject? For a class-typed provider like PrismaService, `constructor(@Inject(PrismaService) private readonly prisma: PrismaService)`. Fine.

Actually wait — does vitest's esbuild emit `experimentalDecorators` correctly (without metadata)? Yes, esbuild supports experimentalDecorators (TC39 decorators also). So @Post/@Get/@Injectable decorators work. Only metadata emission is missing → solved by explicit @Inject.

And for the production tsc build: metadata is also emitted (harmless, redundant).

**Vitest config**: `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    hookTimeout: 60000,
    testTimeout: 60000,
  },
});
```

Tests need DATABASE_URL; Prisma client is generated. I'll note in the test header: requires Postgres at DATABASE_URL + generated client.

**Now tests** — this is the meat. Let me design the fake chain client with file persistence:

```ts
export interface FakeChainOptions {
  stateFile?: string;        // if set, chain state (receipts, broadcast log) is persisted to this file — survives process restarts
  broadcast?: () => 'ok' | 'timeout' | 'reject';  // scriptable behavior per call?
}
```

Simpler scriptable:
```ts
class FakeChainClient implements ChainClient {
  private state: { broadcasts: FakeBroadcast[]; receipts: Record<string, FakeReceipt> };
  private mode: 'ok' | 'timeout' | 'reject' = 'ok';
  broadcastCount...

  setMode(mode) / or take a queue: `enqueueBroadcastOutcome('timeout')` then default ok.
}
```

I'll do: `private outcomes: Array<'ok'|'timeout'|'reject'> = []` — `scriptBroadcast(outcome)` pushes; each `broadcast()` shifts (or default 'ok' if empty). Plus `confirmTx(txId, opts)` / `failTx(txId, reason)` sets receipts (persisted if stateFile). `broadcasts` getter for assertions (persisted).

On stateFile: read on construction, write after each mutation. Synchronous JSON I/O (small). The child crash process writes the broadcast to the file before throwing the timeout (mode 'timeout' → record then throw).

Wait, an important detail for the crash test: the child runs `anchorDocument`, which internally: prepare → persist PREPARED → broadcast (fake: records in file, kills process). If the fake kills the process in `broadcast()`, the child dies before the status update. The fake needs a "die on broadcast" hook: `onBroadcast?: () => void` — the child sets `onBroadcast: () => process.exit(9)`. Where to call it? After recording the broadcast (after chain accepted) — for any mode? If mode is ok and we die, it's still "crash after broadcast." I'll call `onBroadcast?.()` after recording, before handling the mode's outcome (throwing for timeout). Actually if mode is 'ok' and onBroadcast kills the process, it's a crash right after the node accepted. Either works; the crash test uses mode 'timeout' + onBroadcast exit(9)? If we die on exit(9), the timeout throw is moot. Let's use mode 'ok' + onBroadcast → exit(9): models "broadcast sent, response lost / process died." After restart, the sweep: getReceipt → none (not yet confirmed) → re-broadcast same signedTx → ok → BROADCAST_SENT → then test confirms tx → worker pollOnce → CONFIRMED. Assert: 1 row, 1 txId, broadcasts for that txId are 2 (original + re-broadcast, same signedTx bytes!) — "the same signed tx re-broadcast." And assert signedTx equality between the child's original broadcast and the re-broadcast.

Also a variant: crash after chain has confirmed (receipt exists in state file) → sweep confirms directly, no re-broadcast. That's the "timeout but landed" case (can be tested in-process without a crash, but also with a crash). In-process timeout-landed test: mode timeout, but the fake records the broadcast; then test calls confirmTx; sweepOnce → row → getReceipt → receipt → CONFIRMED, assert broadcastCount for that txId is still 1 (no re-broadcast).

Wait — in the in-process flow, `anchorDocument` with mode 'timeout': the fake records the broadcast (chain accepted) and throws the timeout; the service marks OUTCOME_UNKNOWN. Then `confirmTx` (chain confirms it), then `sweepOnce()` → getReceipt → confirm. No re-broadcast.

And "timeout, did not land": fake mode 'timeout' but doesn't record the broadcast? A timeout where the chain didn't accept: the request was lost before reaching the chain. So the fake's 'timeout' mode has two sub-cases. Model: `scriptBroadcast({ outcome: 'timeout', landed: false })`. If landed=false: don't record the broadcast, throw timeout. If landed=true (default): record then throw. The service just sees the throw → OUTCOME_UNKNOWN. The sweep: no receipt, no broadcast record (in our fake, "no trace on chain" = no receipt... hmm — is "no trace" = no receipt, or = no broadcast record?). `getReceipt` is the only query API. "First query getReceipt(txId). If it landed, confirm. Only if there is no trace on-chain may we re-broadcast." Trace = receipt? A tx in the mempool has no receipt yet (receipt = inclusion). So "no trace" via the API = getReceipt returns null. The decision: receipt null → re-broadcast. That's the spec's logic (the API only offers getReceipt). So the `landed` flag only affects whether we later confirm — the sweep behavior is the same: re-broadcast the same signedTx. With landed=true + re-broadcast, the node dedupes (fake: the second broadcast is recorded again — the broadcast log has two entries with the same txId/signedTx; the real chain dedupes). The assertion "one anchor and one transaction identity" = one row, one distinct txId. Good.

For the "did not land" case: the broadcast log has 1 entry after anchor (none, actually — with landed=false, the log is empty), then the sweep re-broadcasts (log has 1), then confirmTx, worker confirms. Total distinct txIds: 1.

**Now the crash test file** — the child script:

`test/crash/child.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { FakeChainClient } from '../../src/chain/fake-chain-client.js';
import { canonicalHashOf } from '../../src/anchors/canonical-hash.js';
// ... reproduce the pre-broadcast + broadcast sequence:
```

Wait — the child should run the actual service (not reimplement the flow), so we test the real code. The child: build AnchorsRepository + AnchorsService directly (no Nest — just `new` with explicit deps):

```ts
const prisma = new PrismaClient();
const chain = new FakeChainClient({ stateFile: stateFile });
chain.scriptBroadcast('timeout');
chain.onBroadcast = () => { process.exit(9); };
const content = { ... a fixed report ... };
const provider = { getContent: async () => content };
const repo = new AnchorsRepository(prisma);
const service = new AnchorsService(provider, chain, repo);
await service.anchorDocument(documentId, version); // dies inside
```

But the constructor with @Inject decorators — `new` works fine (decorators are no-ops at runtime). The service's constructor param order must be stable. OK.

But wait: `process.exit(9)` inside `broadcast()` — the Prisma connection is open; exit(9) terminates without closing — fine (the intent row was already committed). The exit code 9 = our signal "crashed as scripted." The parent asserts exitCode === 9 (died as expected, not a boot failure).

Spawn from the test: `execFile(process.execPath, ['--import', 'tsx', childPath, stateFile, documentId, version])`. Hmm — `--import tsx`: tsx must be resolvable as a package from cwd. With pnpm, it's in node_modules/.pnpm and linked into node_modules → resolvable. `--import tsx` resolves the specifier 'tsx' via node's ESM resolution from cwd → node_modules/tsx. Good.

Edge: vitest already loads tsx? No, vitest uses its own transform. The child is a separate node process. OK.

Alternatively, to avoid the tsx dependency: child in plain ESM JS that imports... src is TS. So no. Keep tsx devDep.

Wait, actually — can the child avoid importing src entirely, by using the dist build? Then the test needs a build step — no, tsx is simpler.

Hmm, another consideration: `process.exit(9)` inside the async chain.broadcast — the Prisma intent commit must be flushed to Postgres before the broadcast (the service awaits the repository create). Yes, the flow awaits. Good.

**Restart and recover** in the parent test:
```ts
const repo = new AnchorsRepository(prisma); // parent's own client
const chain = new FakeChainClient({ stateFile }); // reads file: has the broadcast record, no receipt
const sweep = new RecoverySweepService(repo, chain, { minAgeMs: 0 });
await sweep.sweepOnce(); // no receipt → re-broadcast same signedTx → BROADCAST_SENT
assert: row status BROADCAST_SENT, txId unchanged, broadcast log: 2 entries, both same signedTx
chain.confirmTx(txId);
const worker = new ConfirmationWorkerService(repo, chain);
await worker.pollOnce();
assert: CONFIRMED, blockNumber, exactly 1 row for (doc, version), distinct txId count 1
```

Also assert that the re-broadcast's signedTx === the original (from the child's log) — "the same signed tx re-broadcast."

**Cleanup**: tests need a clean DB. Prisma: `prisma.$executeRaw`? "The repository is the only layer that touches the database" — that's for app code; test cleanup can use prisma directly? To respect the discipline, use the repository? I'll add a `deleteAll()` to the repository (a test helper... it's a legitimate repository method? "deleteAll" in a compliance system is odd but useful for tests; I'll add `prune` / `deleteAll` documented as a test/maintenance op). Hmm. Or in the tests use a unique documentId per test (uuid per spec) — no cleanup needed! Each test uses `randomUUID()` for the documentId → isolation, no deletes.

But the "exactly one anchor" assertion queries the count for that (doc, version) — fine. The crash test also uses a unique id. Great — no deleteAll needed. I'll also delete the state file in an afterAll (fs.rm on the temp file).

**Test DB**: assume Postgres at DATABASE_URL with the migration applied (`prisma migrate deploy` or `db push` before tests — a script `test:prepare`? I'll add a script `"db:migrate": "prisma migrate deploy"` and a note that tests require a migrated DB. Also `pretest`? Keep it simple: document in the test file header comment.

**Now the controller/DTO/validation details**:

`AnchorCreateDto`:
```ts
export class AnchorCreateDto {
  @IsString() @IsNotEmpty() documentId!: string;
  @IsInt() @Min(1) version!: number;
}
```

`VerifyAnchorDto`:
```ts
export class VerifyAnchorDto {
  @IsString() @IsNotEmpty() documentId!: string;
  @IsInt() @Min(1) version!: number;
  @IsDefined() content!: unknown;
}
```

`@IsDefined` on unknown — works (rejects undefined; allows null).

Response DTOs: return plain typed objects (I'll define interfaces). Anchor response:

```ts
{
  id, documentId, version, contentHash, txId, status, broadcastAttempts,
  blockNumber: string | null, blockHash: string | null, failureReason: string | null,
  createdAt: ISO string, updatedAt: ISO string
}
```

Mapping from AnchorRecord in the controller (controller's concern — serializing domain → API). The service returns the domain record; the controller maps.

Verify response:
```ts
{
  documentId, version,
  result: 'verified' | 'content_mismatch' | 'not_anchored' | 'pending' | 'anchor_failed',
  expectedHash: string | null,  // stored hash (null if not anchored)
  actualHash: string,           // hash of supplied content
  proof: { txId: string; blockNumber: string; blockHash: string } | null,
  anchorStatus: string | null,
  failureReason: string | null
}
```

Hmm, let me tidy:
- not_anchored: `{ result: 'not_anchored', expectedHash: null, actualHash, proof: null }`
- content_mismatch: `{ result: 'content_mismatch', expectedHash, actualHash, proof: null }` — "a mismatch report saying what's different": the hash differs; include both. Also anchorStatus (which state the anchor is in) — include for context.
- verified: `{ result: 'verified', expectedHash === actualHash, proof: {txId, blockNumber, blockHash} }`
- pending: `{ result: 'pending', txId, anchorStatus }` (hash matches, not confirmed)
- anchor_failed: `{ result: 'anchor_failed', txId, failureReason }`

I'll type with a discriminated union.

**Service verify** needs to handle canonicalization errors on the supplied content → throw InvalidContentError (400). Yes.

**Statuses as TS types**:

```ts
// anchors.repository.ts or anchor-record.ts
export const AnchorStatus = { Prepared: 'PREPARED', ... } as const;
```

Better: the Prisma-generated enum `AnchorStatus` from `@prisma/client`? The repository maps Prisma's model → domain. The domain can reuse the Prisma enum values. To keep the service independent of Prisma types, I'll define the domain enum in a shared file. Where? I keep going back and forth. Decision: `src/anchors/anchor-status.ts` — hmm the naming rule `kebab-case.role.ts`... The rule enumerates typical roles, not an exhaustive set; a constants/types file within the feature is acceptable (the rule says TS file: kebab-case.role.ts — I'll read "role" as the file's kind; a non-standard kind like a type-defs file needs a name. I could also call it `anchor-types.ts`... not a role. Alternatively, put the domain record type + status union in `anchors.repository.ts` (the repository is the DB boundary, and the record type is its output contract) and the service imports types from the repository file. That's actually natural: the repository defines `AnchorRecord` (its return type), and the service imports the type. And `src/chain/chain-client.ts` defines the chain contract (interface + errors) — the chain module file. `src/content/document-content-provider.ts` defines the port. These aren't "features" per the layout convention, but the layout convention is about the feature structure; shared contract files are fine.

So final file list:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20250101000000_init/migration.sql`
6. `docs/canonicalization.md`
7. `src/main.ts`
8. `src/app.module.ts`
9. `src/prisma/prisma.module.ts`
10. `src/prisma/prisma.service.ts`
11. `src/chain/chain-client.ts` (interface, payload type, error classes)
12. `src/chain/fake-chain-client.ts` (fake impl)
13. `src/chain/chain.module.ts` (provides + exports CHAIN_CLIENT)
14. `src/content/document-content-provider.ts` (port + error + in-memory stand-in)
15. `src/content/content.module.ts`
16. `src/common/domain-error.ts`
17. `src/anchors/anchors.repository.ts`
18. `src/anchors/anchors.service.ts`
19. `src/anchors/anchors.controller.ts`
20. `src/anchors/confirmation.worker.ts` — hmm the naming: role... "worker." `confirmation-worker.ts`? The rule says `<feature>.<role>.ts`... workers are within the anchors feature: `anchors.worker.ts`? Two workers (confirmation + sweep) → one file `anchors.worker.ts` with two services + an orchestrator? Let me think. I'll put both workers + the timer orchestrator in a single file `src/anchors/anchors.worker.ts` (three classes: ConfirmationWorkerService, RecoverySweepService, AnchorWorkersService). The file name `anchors.worker.ts` fits `<feature>.<role>.ts`.
21. `src/anchors/anchors.module.ts`
22. `test/canonical-hash.spec.ts` — wait, where is canonicalHashOf? I said `src/anchors/canonical-hash.ts`?? That's not the role naming either! Hmm. Canonicalization is part of the anchor feature — could go into the service file, but it's tested standalone, used in the service and the verify... The service is the logic layer: canonicalization is business logic → belongs in the service layer. So `src/anchors/anchors.service.ts` exports `canonicalizeJson` + `canonicalHashOf` alongside `AnchorsService`. Test imports from the service file. Acceptable and keeps file count down. Hmm, but the child crash script also imports it — fine, from the service file.

Actually wait — should the canonicalization be in the service, or in a shared utility used by the content provider? Only the anchor/verify logic uses it. Service file. OK.

23. `test/anchors.spec.ts` (anchor flow: happy, 409, timeout → OUTCOME_UNKNOWN, rejection → FAILED, canonicalization rejection 400, missing document 404) — plus HTTP-level tests via Test module + supertest for envelope verification? I'll make anchors.spec.ts a service-level behavior test and add HTTP assertions in one place (maybe the same spec, via a Test module with the controller). Let me organize the specs:

- `test/anchor.spec.ts` — service-level: happy path (status BROADCAST_SENT, intent persisted before broadcast — assert order via fake log: the fake records the broadcast; also assert the DB row exists with PREPARED... how do we assert "persisted before broadcast"? The fake can record the DB state at broadcast time! `onBroadcast` hook: the parent test sets `chain.onBroadcast = async () => { row = await repo.findByDocumentVersion(...) }` — wait onBroadcast is called synchronously inside broadcast(); make the hook async-capable? The service awaits broadcast; inside the fake, before throwing/returning, we can await an async hook and capture the DB row → assert row exists with status PREPARED and has txId. That directly proves write-ahead.
  - 409: anchor the same (doc,version) twice → second throws AlreadyAnchoredError; assert the code 'already_anchored' and details include the existing txId; assert only 1 row in DB (schema-level proof at the app level).
  - Timeout: scriptBroadcast('timeout', landed: true) → service returns status OUTCOME_UNKNOWN, no throw.
  - Rejection: scriptBroadcast('reject') → row FAILED, throws BroadcastRejectedError (code 'broadcast_rejected').
  - Missing document: provider throws → ResourceNotFoundError code 'resource_not_found'.
  - Invalid content: content with NaN → InvalidContentError 'invalid_content' (and no row created, no broadcast).
- `test/verify.spec.ts` — seed rows via the repository (directly, as a test setup, that's fine — the tests can use the repository as a fixture; or go through the service+fake. Direct repository seeding is simpler for the terminal states):
  - Confirmed + matching content → result 'verified', proof with txId/block.
  - Confirmed + mismatched content → 'content_mismatch' with both hashes.
  - No anchor → 'not_anchored'.
  - Pending (BROADCAST_SENT) + matching → 'pending' with txId.
  - Failed + matching → 'anchor_failed' with reason.
  - Mismatched content on pending → 'content_mismatch' (hash check first).
- `test/recovery.spec.ts` —
  - Timeout landed → sweep confirms, no re-broadcast (broadcasts count for txId = 1).
  - Timeout did not land → sweep re-broadcasts same signedTx (log: 2 entries, same signedTx), then confirm + worker → one anchor.
  - Crash test (spawn child) → restart → sweep + worker → one row, one txId, confirmed.
- `test/api.spec.ts`? HTTP envelope tests: 409 envelope shape, 404, 400, 202 shape. The convention "error — one envelope" is a global contract → worth a small API spec via Test.createTestingModule + supertest. I'll add `test/api.spec.ts` covering: POST /anchors 202 envelope field; duplicate → 409 with envelope {error:{code:'already_anchored', details:{}}}; verify 200 with mismatch; validation error 400 (bad version) — envelope for validation errors: the ValidationPipe throws BadRequestException (not a DomainError) → the filter must map HttpException to the envelope too: 400 with code 'bad_request'? For a non-domain HttpException, the filter uses `code: 'validation_failed'`? Let me define the filter behavior:
  - DomainError → its status/code/details.
  - HttpException → status from it, code: mapped: 400 → 'bad_request', 404 → 'resource_not_found', 409 → 'already_anchored', other → 'http_error'? Hmm, the code is the contract and snake_case. For a validation failure, I'll pick `invalid_request`? Let me pick: ValidationPipe throws BadRequestException with an object of constraint messages. The filter: for HttpException, code = a short lowercase of... I'll implement explicit mapping: 400→'invalid_request', 404→'resource_not_found', 409→'already_anchored', 403→'forbidden', 401→'unauthorized', default 'http_error'. details: response object if it's an object, else {}. The message: developer-facing English (exception message or 'Request failed with status N').
  - Non-Http → 500 'internal_error'.

That's a reasonable global filter in main.ts.

Now — do I need supertest? I can test the filter + controller via a Nest app and `app.getHttpServer()` + fetch (Node 20 has global fetch!). I can use `app.listen(0)` and fetch against `http://127.0.0.1:port`. That avoids the supertest dep. Get the port: `(server.address() as AddressInfo).port`. With Nest: `const server = app.getHttpServer(); await app.listen(0); const port = (server.address() as AddressInfo).port;` then fetch. And `await app.close()`. That works, fewer deps. But supertest is standard... "do not create files/deps not called for" — fetch is built in; I'll use fetch. Fewer deps, no problem.

Hmm wait, but with explicit @Inject and no metadata — does the controller's DI for `AnchorsService` work in the Test module? `constructor(@Inject(AnchorsService) private readonly service: AnchorsService)` — yes, explicit token = the class; the Test module's providers include the service. Fine.

For the API spec, I need to override CHAIN_CLIENT and DOCUMENT_CONTENT with fakes: `module.overrideProvider(CHAIN_CLIENT).useValue(fakeChain)`. And the ValidationPipe — main.ts sets it via app.useGlobalPipes; the Test module creates the app via NestFactory? In @nestjs/testing: `const moduleRef = await Test.createTestingModule({...}).compile(); const app = moduleRef.createNestApplication(); app.useGlobalPipes(new ValidationPipe(...)); await app.init();` — I should reuse the exact pipeline from main.ts. To avoid duplication, export a `bootstrapApp()` helper? main.ts's role is bootstrap; I can export a `setupApi(app)` function from main.ts that applies the filter + pipe — testable and DRY. `export function configureApi(app: INestApplication)`. main.ts: `const app = await NestFactory.create(AppModule); configureApi(app); await app.listen(PORT)`. Test: `configureApi(app)`.

PORT env var: `process.env.PORT ?? 3000` — config from env only. In tests, listen(0) overrides anyway (NestFactory.create then app.listen(0)).

**Workers and the Test module**: the AppModule includes AnchorsModule which includes AnchorWorkersService that starts timers on module init — in tests, that pollutes (timers run, and may touch the fake chain — harmless but may flake: the sweep with minAgeMs default 5000 won't touch new rows within 5s; the worker polls BROADCAST_SENT rows → getReceipt on the fake → null → no-op. Mostly harmless but the test DB rows (BROADCAST_SENT) may be picked up by the worker mid-test → advance the state → flaky!). So disable timers in tests: env `CONFIRMATION_POLL_MS=0`, `RECOVERY_SWEEP_MS=0` → the worker starts no timers. Set at the top of the test file (before app creation) or in a vitest setup. I'll set process.env in a `beforeAll` — but onModuleInit runs during module compile/init — the env must be set before `Test.createTestingModule().compile()`. Set at the top level of the test file:

```ts
process.env.CONFIRMATION_POLL_MS ??= '0';
process.env.RECOVERY_SWEEP_MS ??= '0';
```

Top-level side effect in a spec file — acceptable (test env config). Hmm, but other spec files (anchor/verify/recovery) instantiate services directly without Nest — the timers never start. Only the API spec boots the app. OK: set env only in the API spec. Wait — also the crash test: it builds the service directly, no timers. And the recovery test calls sweepOnce directly. Good.

But wait — the recovery sweep in the app (production) has a default minAge of 5000ms; the crash test constructs `RecoverySweepService` directly with explicit `{ minAgeMs: 0 }` — so the constructor signature: `constructor(@Inject(...) repo, @Inject(CHAIN_CLIENT) chain, opts?: { minAgeMs?: number })` — with an optional third param, DI is fine (Nest ignores extra undefined → the factory passes only 2? With @Inject decorators, Nest passes values for params that have known tokens; unknown extra params get undefined? Actually Nest passes undefined for params it can't resolve. With an optional param without a decorator, Nest passes undefined (doesn't throw for a plain optional?). Nest resolves by metadata/decorators; without metadata, for each param... if emitDecoratorMetadata is on (tsc build), `design:paramtypes` includes Object for the opts param → Nest tries to resolve the token `Object` → fails! Careful! With tsc-built metadata, the 3rd param type `Object` → Nest looks up provider `Object` → error "Nest can't resolve dependencies of RecoverySweepService (?, ?, ?)".

Hmm — but wait, in vitest (esbuild), there's no metadata at all → Nest treats all params as unknown → without @Inject, Nest throws "cannot resolve"? How does Nest handle zero metadata? It tries each param: no decorator, no metadata → undefined token → throws. So we need explicit @Inject for every constructor param. Then an extra param without @Inject: Nest iterates params; for those without a resolved token... it throws. Hmm, does Nest throw for a param with no token at all? Yes: "Nest cannot create the module instance. Nest can't resolve dependencies of X (?, ?)."

So: avoid non-injected constructor params. Options: pass config via an injectable token with a default, or read env inside the service. Simplest: the sweep reads `process.env.RECOVERY_MIN_AGE_MS` (default 5000) at construction or per sweep. Env-driven config fits "configuration from env vars only"!

```ts
const MIN_AGE_MS = Math.max(0, Number(process.env.RECOVERY_MIN_AGE_MS ?? 5000));
```
Read per `sweepOnce()` (env is stable at runtime; reading per call makes it testable by setting env in the test — fine). Similarly the worker reads CONFIRMATION_POLL_MS/RECOVERY_SWEEP_MS in onModuleInit. The batch size: `WORKER_BATCH_SIZE` default 50. Good — env only, no constructor param issue.

Wait, but the crash test wants minAge 0: set `process.env.RECOVERY_MIN_AGE_MS = '0'` at the top of the recovery spec (harmless globally for that process). OK.

Also `new RecoverySweepService(repo, chain)` in the test — with the @Inject decorators, `new` with 2 args works (decorators don't affect manual instantiation).

**Explicit @Inject tokens**:
- AnchorsRepository: `@Inject(PrismaService)`.
- ConfirmationWorkerService: repo + CHAIN_CLIENT.
- RecoverySweepService: repo + CHAIN_CLIENT.
- AnchorWorkersService: ConfirmationWorkerService + RecoverySweepService (class tokens with @Inject).
- AnchorsService: DOCUMENT_CONTENT, CHAIN_CLIENT, AnchorsRepository.
- AnchorsController: AnchorsService.
- PrismaService: no deps.

All resolvable.

**Prisma schema details**:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AnchorStatus {
  PREPARED
  BROADCAST_SENT
  OUTCOME_UNKNOWN
  CONFIRMED
  FAILED
  @@map("anchor_status")
}

model Anchor {
  id                String       @id @default(uuid()) @map?
```

Wait — id column: `@id @default(uuid())` maps to column "id" (already snake). With @map convention... the convention says table and columns are snake_case via @map — "id" is fine. Field names in Prisma: camelCase (documentId) mapped to document_id.

```prisma
model Anchor {
  id                String      @id @default(uuid())
  documentId        String      @map("document_id")
  version           Int
  contentHash       String      @map("content_hash")
  txId              String      @unique @map("tx_id")
  signedTx          String      @map("signed_tx")
  payload           Json
  status            AnchorStatus @default(PREPARED)
  broadcastAttempts Int         @default(0) @map("broadcast_attempts")
  blockNumber       BigInt?     @map("block_number")
  blockHash         String?     @map("block_hash")
  failureReason     String?     @map("failure_reason")
  createdAt         DateTime    @default(now()) @map("created_at")
  confirmedAt       DateTime?   @map("confirmed_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")

  @@unique([documentId, version], map: "anchor_document_version_key")
  @@map("anchors")
}
```

`@updatedAt` — Prisma sets it on update. Good for staleness checks.

uuid() default: PG uuid via gen_random_uuid() (Prisma generates `DEFAULT (gen_random_uuid())` in the migration). Fine.

**Migration SQL** (hand-written, must match):

```sql
-- CreateEnum
CREATE TYPE "anchor_status" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "anchor_status" NOT NULL DEFAULT 'PREPARED',
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "block_number" BIGINT,
    "block_hash" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_tx_id_key" ON "anchors"("tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");
```

Note: Prisma's default uuid default is `DEFAULT (gen_random_uuid())` in recent versions — but the id is provided by Prisma client by default (@default(uuid()) → the client generates). In the migration, Prisma writes `DEFAULT (gen_random_uuid())`. I'll include it for fidelity.

Also `@updatedAt` doesn't add a default in the migration (client-managed). Correct: no default for updated_at in SQL — but NOT NULL. Prisma client always sets it. OK.

**Now — the service code in full**:

```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';

export class CanonicalizationError extends Error — wait, error in the common file.
```

Domain errors (`src/common/domain-error.ts`):

```ts
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends DomainError {
  constructor(resource: string, id: string, details = {}) {
    super('resource_not_found', 404, `No ${resource} found for ${id}`, details);
  }
}

export class DocumentVersionNotFoundError extends ResourceNotFoundError {
  constructor(documentId: string, version: number) {
    super('published report version', `${documentId} v${version}`, { documentId, version });
  }
}
```

Hmm wait, the constructor signature of ResourceNotFoundError is (resource, id) — I'll simplify: make each concrete error its own class with an explicit constructor. Let me write it concretely:

```ts
export class AlreadyAnchoredError extends DomainError {
  constructor(documentId: string, version: number, existing: { txId: string; status: string }) {
    super('already_anchored', 409, `(document=${documentId}, version=${version}) is already anchored; exactly one anchor per (document, version) is enforced by the database`, { documentId, version, existingTxId: existing.txId, existingStatus: existing.status });
  }
}

export class InvalidContentError extends DomainError {
  constructor(reason: string) { super('invalid_content', 400, `Report content is not canonicalizable: ${reason}`, { reason }); }
}

export class BroadcastRejectedError extends DomainError {
  constructor(txId: string, reason: string) { super('broadcast_rejected', 502, `Chain rejected the anchor transaction: ${reason}`, { txId, reason }); }
}
```

And `CanonicalizationError` (pre-API, thrown by canonicalizeJson) → the service converts to InvalidContentError. Put `CanonicalizationError` in the service file (the canonicalization function is there). The repository's `DuplicateAnchorError`? The repository throws it; the service catches → AlreadyAnchoredError. Define `DuplicateAnchorError` in the repository file (repository-specific) with the existing record.

Chain errors (`src/chain/chain-client.ts`):

```ts
export class BroadcastTimeoutError extends Error { constructor(message='broadcast timed out; outcome unknown') {super(message); this.name='BroadcastTimeoutError';} }
export class BroadcastRejectionError extends Error { constructor(readonly reason: string) { super(`broadcast rejected: ${reason}`); this.name='BroadcastRejectionError'; } }
```

ChainClient:

```ts
export interface AnchorTxPayload {
  kind: 'report_anchor';
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx { txId: string; signedTx: string; }

export interface ChainReceipt {
  txId: string;
  outcome: 'confirmed' | 'failed';
  blockNumber: bigint;
  blockHash: string;
  failureReason?: string;
}
```

Hmm — a confirmed receipt has blockNumber/blockHash; a failed receipt might not have a block? A failed tx is usually included in a block with status failed (receipt exists, status=0). Let me model: `outcome: 'confirmed' | 'failed'`, blockNumber/blockHash are present for both (the tx is in a block; failed = reverted/rejected on-chain). For a failed receipt, blockNumber is... keep both fields required; a failure before inclusion is a broadcast rejection (different). OK:

```ts
export interface ChainReceipt {
  txId: string;
  outcome: 'confirmed' | 'failed';
  blockNumber: bigint;
  blockHash: string;
  failureReason?: string;
}

export interface ChainClient {
  prepare(tx: AnchorTxPayload): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
```

**FakeChainClient** (`src/chain/fake-chain-client.ts`):

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AnchorTxPayload, BroadcastRejectionError, BroadcastTimeoutError, ChainClient, ChainReceipt, PreparedTx } from './chain-client.js';

interface FakeBroadcastLogEntry { txId: string; signedTx: string; at: string; }
interface FakeChainState { broadcasts: FakeBroadcastLogEntry[]; receipts: Record<string, ChainReceipt> ; }
```

Wait, ChainReceipt has bigint — JSON serialization of bigint → string. Store blockNumber as a string in the file, convert. Handle it: `serializeReceipt` / `deserializeReceipt`. Or store blockNumber as a string in the state, convert when reading: `bigint`.

```ts
export interface FakeChainClientOptions {
  /** When set, chain state (broadcast log and receipts) is persisted to this file so it survives process restarts — the chain is external to any one process. */
  stateFile?: string;
}

export class FakeChainClient implements ChainClient {
  private state: FakeChainState;
  private scripted: Array<'ok' | 'timeout' | 'timeout-not-landed' | 'reject'> = [];
  private rejectionReason = 'simulated rejection';
  /** Called after a broadcast is recorded (i.e. after the fake chain has accepted the tx). Tests may use this to kill the process mid-flight. */
  onBroadcast?: (txId: string) => void;

  constructor(options: FakeChainClientOptions = {}) {
    if (options.stateFile && existsSync(options.stateFile)) {
      this.state = JSON.parse(readFileSync(options.stateFile, 'utf8'));
    } else {
      this.state = { broadcasts: [], receipts: {} };
    }
  }

  private persist() { if (this.stateFile) writeFileSync(this.stateFile, JSON.stringify(this.state)); }

  scriptBroadcast(outcome: 'ok' | 'timeout' | 'timeout-not-landed' | 'reject', rejectionReason?: string) { this.scripted.push(outcome); if (rejectionReason) this.rejectionReason = rejectionReason; }

  get broadcastLog(): ReadonlyArray<FakeBroadcastLogEntry> { return this.state.broadcasts; }
  broadcastCountFor(txId: string) { return this.state.broadcasts.filter(b => b.txId === txId).length; }

  confirmTx(txId: string, blockNumber = 1000n) {
    this.state.receipts[txId] = { txId, outcome: 'confirmed', blockNumber, blockHash: '0x' + sha256hex(txId + ':block:' + blockNumber) };
    this.persist();
  }
  failTx(txId: string, failureReason = 'reverted', blockNumber = 1000n) { ... }

  async prepare(tx: AnchorTxPayload): Promise<PreparedTx> {
    // Local and deterministic: the same payload always produces the same txId and signedTx.
    const txId = '0x' + sha256hex(canonicalStringify(tx));
    return { txId, signedTx: `fake-signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = this.txIdFromSignedTx(signedTx);
    const outcome = this.scripted.shift() ?? 'ok';
    if (outcome === 'timeout-not-landed') {
      // The request was lost before reaching the chain: no record.
      throw new BroadcastTimeoutError();
    }
    // The chain accepted the tx (a real node keeps it even if the response to us is lost).
    this.state.broadcasts.push({ txId, signedTx, at: new Date().toISOString() });
    this.persist();
    this.onBroadcast?.(txId);
    if (outcome === 'timeout') throw new BroadcastTimeoutError();
    if (outcome === 'reject') throw new BroadcastRejectionError(this.rejectionReason);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    const r = this.state.receipts[txId];
    return r ? deserializeReceipt(r) : null;
  }

  private txIdFromSignedTx(signedTx: string): string {
    // 'fake-signed:0x...'
    const idx = signedTx.indexOf('fake-signed:');
    return idx === 0 ? signedTx.slice('fake-signed:'.length) : '0xunknown';
  }
}
```

Wait, `canonicalStringify(tx)` — the fake's prepare uses its own deterministic stringify; I can reuse the service's `canonicalizeJson`? Circular import (service imports chain; chain imports service) — bad. The fake can do its own deterministic stringify: `JSON.stringify(tx, Object.keys(tx).sort())`? A simple stable stringify: keys sorted at the top level (the payload is flat). I'll write a small local `stableStringify` in the fake file. Since the payload is flat (strings/numbers), `JSON.stringify(Object.entries(tx).sort((a,b)=> a[0]<b[0]?-1:1).reduce(...))`. Simple.

The receipt state stored in the file has blockNumber as a string (JSON). I'll store receipts as `Record<string, { outcome, blockNumber: string, blockHash, failureReason? }>` and convert to ChainReceipt (bigint) on read. Internal state type:

```ts
interface StoredReceipt { outcome: 'confirmed' | 'failed'; blockNumber: string; blockHash: string; failureReason?: string; }
interface FakeChainState { broadcasts: ...[]; receipts: Record<string, StoredReceipt>; }
```

confirmTx: `this.state.receipts[txId] = { outcome: 'confirmed', blockNumber: String(blockNumber), blockHash }; this.persist();`

getReceipt: `const s = this.state.receipts[txId]; return s ? { txId, outcome: s.outcome, blockNumber: BigInt(s.blockNumber), blockHash: s.blockHash, ...(s.failureReason ? {failureReason: s.failureReason} : {}) } : null;`

Hmm — also, two processes (the child and the parent) using the same stateFile: the child writes the broadcast; the parent reads on construction. No concurrent writes (the child is dead before the parent constructs its fake). OK.

Edge: `persist()` on every broadcast — if the child dies mid-write via onBroadcast → exit(9), the file could be truncated! Order: persist() (writeFileSync completes) before onBroadcast. So the file is complete before the exit.

**Now AnchorsService**:

```ts
export class AnchorsService {
  constructor(
    @Inject(DOCUMENT_CONTENT) private readonly contentProvider: DocumentContentProvider,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(AnchorsRepository) private readonly anchors: AnchorsRepository,
  ) {}

  async anchorDocument(documentId: string, version: number): Promise<AnchorRecord> {
    const content = await this.loadContent(documentId, version);
    const contentHash = canonicalHashOf(content);
    const tx: AnchorTxPayload = { kind: 'report_anchor', documentId, version, contentHash };
    const prepared = await this.chain.prepare(tx);

    // Write-ahead: the intent, with the tx identity, is committed before the broadcast.
    let record: AnchorRecord;
    try {
      record = await this.anchors.createIntent({ documentId, version, contentHash, txId: prepared.txId, signedTx: prepared.signedTx, payload: tx });
    } catch (e) {
      if (e instanceof DuplicateAnchorError) {
        throw new AlreadyAnchoredError(documentId, version, { txId: e.existing.txId, status: e.existing.status });
      }
      throw e;
    }

    try {
      await this.chain.broadcast(prepared.signedTx);
      return await this.anchors.markBroadcastSent(record.id);
    } catch (e) {
      if (e instanceof BroadcastRejectionError) {
        const failed = await this.anchors.markFailed(record.id, e.reason);
        throw new BroadcastRejectedError(prepared.txId, e.reason);
      }
      // Timeout or any other error: the outcome is unknown — never collapse it into sent/failed.
      return await this.anchors.markOutcomeUnknown(record.id, e instanceof Error ? e.message : String(e));
    }
  }
```

Hmm — markOutcomeUnknown(reason?) stores a note? The status itself says unknown; the reason is for debugging. I'll store it in failureReason? No — failureReason is for FAILED. Add a `lastError` column? Extra. Keep: markOutcomeUnknown just sets the status + attempts. The error message is logged (logger). I'll log in the service with a Logger. OK.

Wait, also: a broadcast rejection → the row is FAILED, and we throw BroadcastRejectedError (502). But hmm — should a definitive rejection leave the slot FAILED permanently (blocking re-anchoring of the same version)? As decided: yes, the slot is occupied; a new version is the remedy. The 502 response tells the caller. And the recovery sweep won't touch FAILED. OK.

Hmm, actually wait. Let me reconsider: is FAILED + blocked re-anchoring really correct for the "broadcast rejected" case? The rejection means our tx was never accepted (e.g. invalid). The version is not anchored on-chain. Operationally, we'd want to re-anchor the same version with a new tx. But "exactly one anchor per (document, version), enforced at the schema level" — the schema only enforces uniqueness of the row; application policy decides whether FAILED frees the slot. The spec's state list includes FAILED as terminal (the recovery sweep doesn't mention re-trying FAILED). The acceptance criteria only say "anchor the same (document, version) twice → rejected by the database." A second attempt after FAILED → also a duplicate row → rejected by the DB. I'll keep it strict (FAILED is terminal; the error message can say "use a new version"). That's the most defensible strict reading. I'll note it in a comment.

  async verify(documentId, version, content) → VerifyResult:

```ts
const record = await this.anchors.findByDocumentVersion(documentId, version);
const actualHash = canonicalHashOf(content); // throws CanonicalizationError → caller converts?
if (!record) return { result: 'not_anchored', documentId, version, expectedHash: null, actualHash, proof: null, anchorStatus: null, failureReason: null };
if (actualHash !== record.contentHash) return { result: 'content_mismatch', ..., expectedHash: record.contentHash, actualHash, proof: null, anchorStatus: record.status, failureReason: record.failureReason };
switch (record.status) {
  case 'CONFIRMED': return { result: 'verified', expectedHash, actualHash, proof: { txId: record.txId, blockNumber: record.blockNumber, blockHash: record.blockHash }, ... };
  case 'FAILED': return { result: 'anchor_failed', ..., failureReason: record.failureReason ?? 'unknown' };
  default: return { result: 'pending', proof: null, anchorStatus: record.status, txId? include proof: null but txId in details? }
}
```

For pending: the proof is null; include `txId` (the identity exists) — auditors can watch the chain. I'll add `txId` to the union for pending/failed.

Let me define the union:

```ts
export type VerifyResult =
  | { result: 'verified'; documentId: string; version: number; expectedHash: string; actualHash: string; proof: { txId: string; blockNumber: bigint; blockHash: string }; anchorStatus: 'CONFIRMED'; failureReason: null }
  | { result: 'content_mismatch'; ...; proof: null; anchorStatus: AnchorStatusValue; failureReason: string | null }
  | { result: 'not_anchored'; ... expectedHash: null; proof: null; anchorStatus: null }
  | { result: 'pending'; ...; proof: null; txId: string; anchorStatus: 'PREPARED'|'BROADCAST_SENT'|'OUTCOME_UNKNOWN' }
  | { result: 'anchor_failed'; ...; proof: null; txId: string; failureReason: string };
```

The controller serializes bigint → string. I'll keep blockNumber as bigint in the domain and let the controller map to `String(...)`.

`loadContent`:
```ts
private async loadContent(documentId: string, version: number): Promise<unknown> {
  try {
    return await this.contentProvider.getContent(documentId, version);
  } catch (e) {
    if (e instanceof DocumentVersionNotFoundError) throw e; // already a DomainError
    throw new DocumentVersionNotFoundError(documentId, version); // wrap unknown provider failure? no — rethrow?
  }
}
```
Simpler: the provider contract: throws `DocumentVersionNotFoundError` when missing. The service just calls it. I'll document the contract in the port file. No try/catch.

**Canonicalization in the service file**:

```ts
/**
 * Canonicalization — the single definition of how report content becomes bytes.
 * (Written out fully in docs/canonicalization.md; this is the normative implementation.)
 */
export class CanonicalizationError extends Error {
  constructor(message: string) { super(`canonicalization failed: ${message}`); this.name = 'CanonicalizationError'; }
}

export function canonicalizeJson(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalizationError(`non-finite number ${String(value)} is not representable in JSON`);
    return String(value); // ECMAScript shortest round-trip form; -0 serializes as "0"
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeJson(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(); // ascending UTF-16 code unit order, locale-independent
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(',')}}`;
  }
  throw new CanonicalizationError(`value of type ${typeof value} is not a JSON value (undefined, symbol or function)`);
}

export function canonicalHashOf(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
}
```

Wrap in the service: in anchorDocument/verify, catch CanonicalizationError → InvalidContentError.

```ts
private hashContent(content: unknown): string {
  try {
    return canonicalHashOf(content);
  } catch (e) {
    if (e instanceof CanonicalizationError) throw new InvalidContentError(e.message);
    throw e;
  }
}
```

**Repository**:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type AnchorStatusValue = 'PREPARED' | 'BROADCAST_SENT' | 'OUTCOME_UNKNOWN' | 'CONFIRMED' | 'FAILED';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  payload: AnchorTxPayload;  // import type from chain — fine
  status: AnchorStatusValue;
  broadcastAttempts: number;
  blockNumber: bigint | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date;
}
```

Importing AnchorTxPayload from '../chain/chain-client.js' in the repository — acceptable (it's a type).

```ts
export class DuplicateAnchorError extends Error {
  constructor(readonly existing: AnchorRecord) { super('an anchor already exists for this (document, version)'); this.name = 'DuplicateAnchorError'; }
}

@Injectable()
export class AnchorsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createIntent(input: { documentId: string; version: number; contentHash: string; txId: string; signedTx: string; payload: AnchorTxPayload }): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.anchor.create({ data: input });
      return this.toRecord(row);
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        const existingRow = await this.prisma.anchor.findFirst({ where: { documentId: input.documentId, version: input.version } });
        if (existingRow) throw new DuplicateAnchorError(this.toRecord(existingRow));
      }
      throw e;
    }
  }
```

Hmm — P2002 can also come from the tx_id unique (shouldn't happen: txId is fresh per new content hash; but a re-prepare of the same payload with a new documentId? the payload includes documentId+version+hash, so the same txId implies the same payload → the same (doc,version) → the first constraint fires first... order: Postgres may check the tx_id index before the composite one! If the composite is violated, both indexes are checked during insert; P2002's `meta.target` tells which. If the tx_id target hits (same txId, different doc?), that's impossible here. Anyway: to be safe, on P2002, look up by (doc,version); if found → duplicate anchor; otherwise rethrow the original. OK, covered.

`findFirst` by (documentId, version) — need a unique input: `findUnique({ where: { documentId_version: { documentId, version } } })`.

  findByDocumentVersion: findUnique, return null.

  findBroadcastSent(limit):
  ```ts
  const rows = await this.prisma.anchor.findMany({ where: { status: 'BROADCAST_SENT' }, orderBy: { updatedAt: 'asc' }, take: limit });
  ```

  findStuck(olderThanMs, limit):
  ```ts
  const cutoff = new Date(Date.now() - olderThanMs);
  where: { status: { in: ['PREPARED', 'OUTCOME_UNKNOWN'] }, updatedAt: { lt: cutoff } }
  ```

  markBroadcastSent(id): `update({ where: { id }, data: { status: 'BROADCAST_SENT', broadcastAttempts: { increment: 1 } } })` → toRecord.
  markOutcomeUnknown(id): same with status OUTCOME_UNKNOWN + attempts increment.
  markConfirmed(id, receipt: ChainReceipt): data: status CONFIRMED, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, confirmedAt: new Date().
  markFailed(id, reason): status FAILED, failureReason: reason.

toRecord: the row from Prisma — the payload Json → `row.payload as AnchorTxPayload`. blockNumber bigint. status: cast to AnchorStatusValue (the Prisma enum is the same string values — the generated enum is a union of strings? Prisma generates enum values as TS string unions/const objects. Assignable to my union).

**Workers** (`src/anchors/anchors.worker.ts`):

```ts
@Injectable()
export class ConfirmationWorkerService {
  constructor(@Inject(AnchorsRepository) private readonly anchors: AnchorsRepository, @Inject(CHAIN_CLIENT) private readonly chain: ChainClient) {}

  /** Polls receipts for anchors that are broadcast-sent and advances their state. Confirmation comes only from a receipt, never from a broadcast() return. */
  async pollOnce(): Promise<number> {
    const batchSize = Number(process.env.WORKER_BATCH_SIZE ?? 50);
    const rows = await this.anchors.findBroadcastSent(batchSize);
    let advanced = 0;
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      if (receipt.outcome === 'confirmed') await this.anchors.markConfirmed(row.id, receipt);
      else await this.anchors.markFailed(row.id, receipt.failureReason ?? 'transaction failed on chain');
      advanced++;
    }
    return advanced;
  }
}

@Injectable()
export class RecoverySweepService {
  constructor(repo, chain) {}

  /**
   * Resolves anchors stuck in broadcast limbo (PREPARED or OUTCOME_UNKNOWN).
   * Chain first: always ask getReceipt(txId) before acting. If the tx landed, we confirm it;
   * only if the chain has no trace do we re-broadcast — the same stored signed transaction,
   * never a freshly prepared one, so a resend cannot turn into a second anchor.
   */
  async sweepOnce(): Promise<number> {
    const batchSize = Number(process.env.WORKER_BATCH_SIZE ?? 50);
    const minAgeMs = Math.max(0, Number(process.env.RECOVERY_MIN_AGE_MS ?? 5000));
    const rows = await this.anchors.findStuck(minAgeMs, batchSize);
    let resolved = 0;
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        if (receipt.outcome === 'confirmed') await this.anchors.markConfirmed(row.id, receipt);
        else await this.anchors.markFailed(row.id, receipt.failureReason ?? 'transaction failed on chain');
        resolved++;
        continue;
      }
      // No trace on chain: re-broadcast the same signed transaction.
      try {
        await this.chain.broadcast(row.signedTx);
        await this.anchors.markBroadcastSent(row.id);
      } catch (e) {
        if (e instanceof BroadcastRejectionError) {
          await this.anchors.markFailed(row.id, e.reason);
        } else {
          await this.anchors.markOutcomeUnknown(row.id); // still unknown; retry on next sweep
        }
      }
      resolved++;
    }
    return resolved;
  }
}
```

Hmm, `resolved` counts processed (including those that remain unknown) — rename `processed`. Fine.

```ts
@Injectable()
export class AnchorWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorWorkersService.name);
  private timers: NodeJS.Timeout[] = [];
  constructor(@Inject(ConfirmationWorkerService) private readonly confirmationWorker: ConfirmationWorkerService, @Inject(RecoverySweepService) private readonly recoverySweep: RecoverySweepService) {}

  onModuleInit(): void {
    const pollMs = Number(process.env.CONFIRMATION_POLL_MS ?? 2000);
    const sweepMs = Number(process.env.RECOVERY_SWEEP_MS ?? 10000);
    if (pollMs > 0) this.timers.push(setInterval(() => { void this.safeRun('confirmation worker', () => this.confirmationWorker.pollOnce()); }, pollMs));
    if (sweepMs > 0) this.timers.push(setInterval(() => { void this.safeRun('recovery sweep', () => this.recoverySweep.sweepOnce()); }, sweepMs));
    this.logger.log(`workers started (confirmationPollMs=${pollMs || 'off'}, recoverySweepMs=${sweepMs || 'off'})`);
  }
  onModuleDestroy(): void { for (const t of this.timers) clearInterval(t); this.timers = []; }
  private safeRun(name: string, fn: () => Promise<number>): void {
    fn().then(n => n > 0 && this.logger.log(`${name}: processed ${n}`)).catch(err => this.logger.error(`${name} failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}
```

**AnchorsModule**:

```ts
@Module({
  imports: [PrismaModule, ChainModule, ContentModule],
  controllers: [AnchorsController],
  providers: [AnchorsRepository, AnchorsService, ConfirmationWorkerService, RecoverySweepService, AnchorWorkersService],
})
export class AnchorsModule {}
```

**AppModule**: imports PrismaModule (for... does the app need prisma directly? Only the anchors module. But PrismaModule global? Make PrismaModule @Global() to simplify? The wiring convention says explicit import/export. I'll keep it explicit: AnchorsModule imports PrismaModule. AppModule imports AnchorsModule. Then AppModule doesn't need the others. ChainModule and ContentModule provide their tokens and are imported by AnchorsModule.

Wait — the ChainModule provides CHAIN_CLIENT with a factory → FakeChainClient. ContentModule provides DOCUMENT_CONTENT → an in-memory provider. Both exported.

**Content module**:

```ts
// src/content/document-content-provider.ts
export class DocumentVersionNotFoundError extends DomainError {
  constructor(documentId: string, version: number) {
    super('resource_not_found', 404, `No published report content for document ${documentId} version ${version}`, { documentId, version });
  }
}

export interface DocumentContentProvider {
  /** Returns the structured JSON content of a published report version.
   *  Implementations must throw DocumentVersionNotFoundError when the version does not exist. */
  getContent(documentId: string, version: number): Promise<unknown>;
}

// Development stand-in: the production report store implements this port.
export class InMemoryDocumentContentProvider implements DocumentContentProvider {
  private readonly content = new Map<string, unknown>(); // key `${documentId}@${version}`
  publish(documentId: string, version: number, content: unknown): void { this.content.set(key, content); }
  async getContent(documentId: string, version: number): Promise<unknown> {
    const c = this.content.get(key);
    if (c === undefined) throw new DocumentVersionNotFoundError(documentId, version);
    return c;
  }
}
```

Module: `@Module({ providers: [{ provide: DOCUMENT_CONTENT, useFactory: () => new InMemoryDocumentContentProvider() }], exports: [DOCUMENT_CONTENT] })`.

ChainModule: `providers: [{ provide: CHAIN_CLIENT, useFactory: () => new FakeChainClient() }], exports: [CHAIN_CLIENT]`. Comment: the production L2 client implements ChainClient; the fake is the wired stand-in since this build has no keys/RPC.

Where to define the tokens? `src/chain/chain-client.ts`: `export const CHAIN_CLIENT = 'CHAIN_CLIENT';` and the content file: `export const DOCUMENT_CONTENT = 'DOCUMENT_CONTENT';`.

**Controller**:

```ts
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { IsDefined, IsInt, IsNotEmpty, Min } from 'class-validator';
import { AnchorsService } from './anchors.service.js';

export class AnchorCreateDto {
  @IsString() @IsNotEmpty() documentId!: string;
  @IsInt() @Min(1) version!: number;
}

export class VerifyAnchorDto {
  @IsString() @IsNotEmpty() documentId!: string;
  @IsInt() @Min(1) version!: number;
  @IsDefined() content!: unknown;
}

@Controller('anchors')
export class AnchorsController {
  constructor(@Inject(AnchorsService) private readonly service: AnchorsService) {}

  /** POST /anchors — anchor the structured content of a published (document, version). 202: the intent is committed; confirmation is asynchronous. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async anchorDocument(@Body() body: AnchorCreateDto) {
    return this.toAnchorDto(await this.service.anchorDocument(body.documentId, body.version));
  }

  /** POST /anchors/verify — recompute the hash from the supplied content; return the anchoring proof or a mismatch report. */
  @Post('verify')
  async verify(@Body() body: VerifyAnchorDto) {
    return this.toVerifyDto(await this.service.verify(body.documentId, body.version, body.content));
  }

  private toAnchorDto(r: AnchorRecord) { ... map, bigints → string, dates → ISO }
  private toVerifyDto(v: VerifyResult) { ... blockNumber → String }
}
```

Note: route order — `@Post('verify')` vs `@Post()` — no conflict (different paths).

Endpoint convention: "endpoint: kebab-case, plural" — `/anchors` and `/anchors/verify` ✓.

**main.ts**:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import type { INestApplication, ArgumentsHost as AH } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { DomainError } from './common/domain-error.js';

/** The single error envelope for the whole API: { error: { code, message, details } }. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiErrorFilter');
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();  // express response type — import from 'express'? @types/express available via platform-express. Use `any`? Use `Record`... I'll type it minimally: const res = ctx.getResponse() as { status(code: number): { json(b: unknown): unknown } }; hmm, Express's Response has .status().json(). I'll write a small structural type.
    ...
  }
}
```

To avoid @types/express import hassle, structural type:

```ts
type HttpResponse = { status(code: number): { json(body: unknown): void } };
```

Logic:
```ts
let status: number; let code: string; let message: string; let details: Record<string, unknown> = {};
if (exception instanceof DomainError) {
  status = exception.httpStatus; code = exception.code; message = exception.message; details = exception.details;
} else if (exception instanceof HttpException) {
  status = exception.getStatus();
  const r = exception.getResponse();
  if (typeof r === 'string') { message = r; code = statusCodeToCode(status); }
  else {
    const obj = r as Record<string, unknown>;
    message = typeof obj.message === 'string' ? obj.message : Array.isArray(obj.message) ? obj.message.join('; ') : exception.message;
    code = statusCodeToCode(status);
    if (obj.message !== undefined || obj.error !== undefined) details = { ...(obj as object) }...
  }
}
```

Hmm, ValidationPipe's BadRequestException's getResponse() = `{ statusCode: 400, message: [...constraints], error: 'Bad Request' }`. Envelope: code 'invalid_request', message = joined constraints, details = the full response object? details should be an object, never null — I'll use details = obj (it's an object). Ensure it's a plain object: `details = (typeof r === 'object' && r !== null) ? (r as Record<string, unknown>) : {}`.

statusCodeToCode: 400 → 'invalid_request', 401 → 'unauthorized', 403 → 'forbidden', 404 → 'resource_not_found', 409 → 'already_anchored', 422 → 'invalid_request', default 'http_error'.

else (unknown): status 500, code 'internal_error', message 'Unexpected error: ...' (dev-facing), details: { name, message }? Log the stack.

Then `res.status(status).json({ error: { code, message, details } })`.

`configureApi(app)`:
```ts
export function configureApi(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiErrorFilter());
}
```

main:
```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApi(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`report-anchoring API listening on :${port}`, 'Bootstrap');
}
void bootstrap();
```

Wait — in the test, `configureApi` from main.ts: importing main.ts runs the bootstrap?! Guard: `if (require.main === module)` — in ESM: `import.meta.url === pathToFileURL(process.argv[1]).href`. Simpler: only run bootstrap when not in test: `if (process.env.NODE_ENV !== 'test')`? Vitest sets NODE_ENV=test by default. Hmm, a bit hacky but common. Better: use the ESM main-module check:

```ts
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) void bootstrap();
```

When the test imports configureApi, argv[1] is the vitest binary → isMain is false → no bootstrap. When running `node dist/main.js`, argv[1]=.../dist/main.js → matches.

**PrismaService/Module**:

```ts
// prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```

PrismaClient constructor: `new PrismaClient()` reads DATABASE_URL from env.

```ts
// prisma.module.ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```
@Global or explicit import? The wiring convention says explicit. I'll drop @Global and have AnchorsModule import PrismaModule.

**Now the tests in full.**

Shared test helper? A `test/helpers.ts` file? "Do not create files not called for" — helpers reduce duplication; borderline. I can inline the setup in each spec (a small `buildHarness()` per spec). To be safe, I'll inline a small helper in each spec that needs it (a few lines), or create one `test/test-helpers.ts`... I think one helper file is defensible (tests are called for; the helpers are part of them). I'll create `test/harness.ts` with:

```ts
export interface Harness { prisma, chain (FakeChainClient), content (InMemoryDocumentContentProvider), repo, service, confirmation, sweep }
export function createHarness(): Harness {
  const prisma = new PrismaClient();
  const chain = new FakeChainClient();
  const content = new InMemoryDocumentContentProvider();
  const repo = new AnchorsRepository(prisma);
  const service = new AnchorsService(content, chain, repo);
  const confirmation = new ConfirmationWorkerService(repo, chain);
  const sweep = new RecoverySweepService(repo, chain);
  return { prisma, chain, content, repo, service, confirmation, sweep };
}
export async function disposeHarness(h) { await h.prisma.$disconnect(); }
```

Also `export const SAMPLE_CONTENT = {...}` a fixed report object with nested keys out of order, strings, numbers, arrays, UTF-8, to make the hash deterministic across tests. Put in the harness.

Hmm — the harness is created per test with `beforeEach` and disposed in `afterEach`. Each spec file has its own PrismaClient — fine.

`test/anchor.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
...
describe('anchorDocument', () => {
  let h: Harness; let docId: string;
  beforeEach(() => { h = createHarness(); docId = `doc-${randomUUID()}`; h.content.publish(docId, 1, SAMPLE_CONTENT); });
  afterEach(() => disposeHarness(h));

  it('commits the anchor intent with the tx identity before broadcasting, then broadcasts', async () => {
    let rowAtBroadcast: AnchorRecord | null = null;
    h.chain.onBroadcast = () => { void (async () => { rowAtBroadcast = await h.repo.findByDocumentVersion(docId, 1); })(); };
    hmm — the onBroadcast hook is synchronous inside broadcast(); the DB read is async. The hook can't easily await inside broadcast (broadcast awaits the hook? make onBroadcast async-capable: `onBroadcast?: (txId) => void | Promise<void>` and `await this.onBroadcast?.(txId)` in the fake broadcast before throwing/returning.
    
    So the fake: after recording + persist, `if (this.onBroadcast) await this.onBroadcast(txId);` then throw if timeout.
    
    await h.service.anchorDocument(docId, 1);
    expect(rowAtBroadcast).not.toBeNull();
    expect(rowAtBroadcast!.status).toBe('PREPARED'); // the intent was committed before the chain saw the tx
    expect(rowAtBroadcast!.txId).toMatch(/^0x[0-9a-f]{64}$/);
    const row = await h.repo.findByDocumentVersion(docId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(row!.txId).toBe(rowAtBroadcast!.txId);
    expect(h.chain.broadcastCountFor(row!.txId)).toBe(1);
  });
```

Wait — the final status after anchorDocument (broadcast ok) is BROADCAST_SENT (not confirmed; confirmation is from the worker). ✓. Also the contentHash equals the hash of SAMPLE_CONTENT.

  it('rejects a second anchor for the same (document, version) with the database constraint', async () => {
    await h.service.anchorDocument(docId, 1);
    await expect(h.service.anchorDocument(docId, 1)).rejects.toThrow(AlreadyAnchoredError);
    const rows = await h.repo.findAllForDocument(docId)? — need a count method. Add repository `countByDocumentVersion(documentId, version)` → number. Use it: expect 1.
    Also expect only one distinct txId (trivially).
  });

  it('records OUTCOME_UNKNOWN when the broadcast times out (landed or not)', async () => {
    h.chain.scriptBroadcast('timeout');
    const record = await h.service.anchorDocument(docId, 1);
    expect(record.status).toBe('OUTCOME_UNKNOWN');
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1); // the fake landed=true by default
  });

  it('marks FAILED and reports broadcast_rejected when the chain definitively rejects', async () => {
    h.chain.scriptBroadcast('reject', 'invalid signature');
    await expect(h.service.anchorDocument(docId, 1)).rejects.toThrow(BroadcastRejectedError);
    const row = await h.repo.findByDocumentVersion(docId, 1);
    expect(row!.status).toBe('FAILED');
    expect(row!.failureReason).toContain('invalid signature');
  });

  it('returns resource_not_found when the version has no published content', async () => {
    await expect(h.service.anchorDocument(docId, 99)).rejects.toThrow(DocumentVersionNotFoundError);
    // no anchor row was created
    expect(await h.repo.countByDocumentVersion(docId, 99)).toBe(0);
  });

  it('refuses non-canonicalizable content without touching the chain', async () => {
    h.content.publish(docId, 1, { score: Number.NaN });
    await expect(h.service.anchorDocument(docId, 1)).rejects.toThrow(InvalidContentError);
    expect(h.chain.broadcastLog).toHaveLength(0);
  });
});
```

`rejects.toThrow(AlreadyAnchoredError)` — vitest supports class matching. Also assert the code: `await expect(...).rejects.toMatchObject({ code: 'already_anchored', httpStatus: 409 })` — better behavior (contract). I'll assert the code/status and the details (existingTxId).

`test/verify.spec.ts`:

Seed via the repository: createIntent then mark* — the repository is the test fixture path (allowed; the test harness uses layers directly). Or go through the service with a scripted fake (more end-to-end): e.g., for confirmed: anchorDocument (ok) → chain.confirmTx(txId) → confirmation.pollOnce() → CONFIRMED. That's better (exercises the real path). I'll do that for the verified case; for the failed case, script a rejection; for pending, default; for not_anchored, no-op.

```ts
describe('verify', () => {
  it('returns the anchoring proof (txId, block) for matching content', async () => {
    const rec = await h.service.anchorDocument(docId, 1);
    h.chain.confirmTx(rec.txId, 4321n);
    await h.confirmation.pollOnce();
    const report = await h.service.verify(docId, 1, SAMPLE_CONTENT);
    expect(report.result).toBe('verified');
    expect(report.proof).toEqual({ txId: rec.txId, blockNumber: 4321n, blockHash: expect.any(String) });
    expect(report.actualHash).toBe(report.expectedHash);
  });

  it('recomputes the hash from the supplied content, not from storage: mismatched content yields a mismatch report', async () => {
    await h.service.anchorDocument(docId, 1);
    h.chain.confirmTx(...); await h.confirmation.pollOnce();
    const tampered = { ...SAMPLE_CONTENT, sections: [...SAMPLE_CONTENT.sections].reverse() }; // different order → different canonical form
    const report = await h.service.verify(docId, 1, tampered);
    expect(report.result).toBe('content_mismatch');
    expect(report.expectedHash).toBe(canonicalHashOf(SAMPLE_CONTENT));
    expect(report.actualHash).toBe(canonicalHashOf(tampered));
    expect(report.expectedHash).not.toBe(report.actualHash);
  });

  it('reports not_anchored when no anchor exists for the version', ...);
  it('reports pending with the tx identity when the anchor is not yet confirmed', ...);
  it('reports anchor_failed with the reason when the anchor failed', ...);
  it('prefers content_mismatch over anchor state when the hash differs', ...); // e.g. pending + tampered → content_mismatch
});
```

The tampered SAMPLE_CONTENT: I need to ensure the canonical form actually differs. I'll design SAMPLE_CONTENT with object key order that differs from sorted order + a string array where reversing changes the form. Example:

```ts
export const SAMPLE_CONTENT = {
  reportType: 'clinical-summary',
  subject: 'Patient 000-1234',
  vitals: { heartRate: 72, spo2: 0.98, notes: 'stable, no intervention' },
  sections: ['admission', 'course', 'discharge'],
  metadata: { author: 'dr. ávila', unit: 'ICU-3', reviewed: true },
};
```
Note: object key insertion order is unsorted ('heartRate' vs 'spo2' — sorted: heartRate < spo2? 'h' < 's' yes; 'reportType','subject','vitals','sections','metadata' — insertion order ≠ sorted → canonicalization reorders. Numbers: 0.98 (decimal), true, UTF-8 'á'. Tampered: reverse sections → different hash. Or change spo2 to 0.97. I'll use both a reversal (positional sensitivity) — good for proving array order matters.

`test/recovery.spec.ts`:

```ts
describe('recovery sweep', () => {
  it('confirms from the receipt when the broadcast timed out but landed — no re-broadcast', async () => {
    h.chain.scriptBroadcast('timeout');
    const rec = await h.service.anchorDocument(docId, 1);
    expect(rec.status).toBe('OUTCOME_UNKNOWN');
    h.chain.confirmTx(rec.txId, 77n);
    await h.sweep.sweepOnce();
    const row = await h.repo.findByDocumentVersion(docId, 1);
    expect(row!.status).toBe('CONFIRMED');
    expect(row!.blockNumber).toBe(77n);
    expect(h.chain.broadcastCountFor(rec.txId)).toBe(1); // no re-broadcast
  });

  it('re-broadcasts the same signed tx when the chain has no trace, yielding one anchor and one tx identity', async () => {
    h.chain.scriptBroadcast('timeout-not-landed');
    const rec = await h.service.anchorDocument(docId, 1);
    expect(rec.status).toBe('OUTCOME_UNKNOWN');
    expect(h.chain.broadcastLog).toHaveLength(0);
    await h.sweep.sweepOnce(); // no receipt → re-broadcast the same signedTx
    const row = await h.repo.findByDocumentVersion(docId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(h.chain.broadcastCountFor(rec.txId)).toBe(1);
    expect(h.chain.broadcastLog[0].signedTx).toBe(rec.signedTx); // the same one, not a new one
    h.chain.confirmTx(rec.txId);
    await h.confirmation.pollOnce();
    expect((await h.repo.findByDocumentVersion(docId, 1))!.status).toBe('CONFIRMED');
    expect(await h.repo.countByDocumentVersion(docId, 1)).toBe(1);
  });

  it('a stale PREPARED row (crashed before the broadcast call) is broadcast by the sweep', async () => {
    // seed a PREPARED row directly: intent persisted, process died before broadcast
    const content = SAMPLE_CONTENT;
    const prepared = await h.chain.prepare(payloadFor(docId, 1, content));
    await h.repo.createIntent({ documentId: docId, version: 1, contentHash: canonicalHashOf(content), txId: prepared.txId, signedTx: prepared.signedTx, payload: ... });
    await h.sweep.sweepOnce();
    expect(row status BROADCAST_SENT); broadcastCount 1; signedTx is the stored one.
  });
```

Hmm — for the PREPARED seed I need the payload: `{ kind:'report_anchor', documentId, version, contentHash }` — build it inline. Fine.

Crash test:

```ts
  it('process crash between broadcast and status update: restart recovers, exactly one anchor and one tx identity', async () => {
    const stateFile = path.join(os.tmpdir(), `fake-chain-${randomUUID()}.json`);
    try {
      const child = path.resolve(__dirname?, '../crash/child.ts') — in ESM vitest: use new URL('crash/child.ts', import.meta.url) → fileURLToPath.
      const docId2 = `doc-${randomUUID()}`;
      const childProcess = spawn(process.execPath, ['--import', 'tsx', childScript, stateFile, docId2, '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      childProcess.stderr.on('data', d => stderr += d);
      const code = await new Promise<number>(resolve => childProcess.on('close', resolve));
      expect(code).toBe(9); // the scripted crash, not a boot failure
      if (code !== 9) throw new Error(stderr);

      // Restart: same chain (file-backed), fresh app services.
      const chain2 = new FakeChainClient({ stateFile });
      const repo2 = new AnchorsRepository(h.prisma);
      // The chain accepted the tx before the crash: exactly one broadcast, no receipt.
      const rows = await repo2... find by (docId2, 1) → status PREPARED (the crash prevented the status update).
      expect(row.status).toBe('PREPARED');
      const originalSignedTx = chain2.broadcastLog[0].signedTx;
      expect(chain2.broadcastLog).toHaveLength(1);

      const sweep2 = new RecoverySweepService(repo2, chain2);
      await sweep2.sweepOnce(); // chain first: no receipt → re-broadcast the same signed tx
      let row2 = await repo2.findByDocumentVersion(docId2, 1);
      expect(row2.status).toBe('BROADCAST_SENT');
      expect(row2.txId).toBe(row.txId);
      expect(chain2.broadcastCountFor(row.txId)).toBe(2);
      expect(chain2.broadcastLog[1].signedTx).toBe(originalSignedTx); // the same signed tx, not a new one

      chain2.confirmTx(row.txId, 555n);
      const confirmation2 = new ConfirmationWorkerService(repo2, chain2);
      await confirmation2.pollOnce();
      row2 = await repo2.findByDocumentVersion(docId2, 1);
      expect(row2.status).toBe('CONFIRMED');
      expect(await repo2.countByDocumentVersion(docId2, 1)).toBe(1); // exactly one anchor
      // exactly one transaction identity
      expect(new Set(chain2.broadcastLog.map(b => b.txId)).size).toBe(1);
    } finally {
      fs.rmSync(stateFile, { force: true });
    }
  });
```

Also a second crash variant: crash after the chain has already confirmed (the receipt is in the file) → the sweep confirms without re-broadcasting. The child would need to: anchor, wait for confirm... the child would need to confirmTx after the broadcast and before dying. I can parameterize the child with an env/arg `CONFIRM_BEFORE_CRASH=1`: after the onBroadcast hook... hmm, the onBroadcast hook runs inside the child's fake; the child sets `chain.onBroadcast = (txId) => { if (confirmFirst) chain.confirmTx(txId, 4242n); process.exit(9); }`. Then the parent's sweep: getReceipt → present → CONFIRMED, broadcastCount stays 1. I'll add this variant — it directly proves "timeout but landed → recovery confirms, no re-broadcast" across a real crash. The child args: stateFile, docId, version, confirmBeforeCrash (0/1).

Wait, in the confirmFirst case, the child's fake records the broadcast, then confirmTx (writes the receipt to the file), then exit(9). Parent: row PREPARED, chain2 reads the file: broadcasts 1, receipts 1. sweepOnce: getReceipt → confirmed → markConfirmed. broadcastCount 1. ✓ "Broadcast times out but landed → recovery confirms from receipt, no re-broadcast" across a real crash.

**Child script** (`test/crash/child.ts`):

```ts
/**
 * Spawned by test/recovery.spec.ts. Reproduces the incident window: it runs the real
 * anchorDocument against a file-backed fake chain, and the fake kills the process
 * (exit code 9) the instant the chain accepts the tx — i.e. between the broadcast and
 * the status update (the point where a naive design would persist the anchor).
 */
import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../../src/anchors/anchors.repository.js';
import { AnchorsService } from '../../src/anchors/anchors.service.js';
import { FakeChainClient } from '../../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../../src/content/document-content-provider.js';

const [stateFile, documentId, versionRaw, confirmBeforeCrashRaw] = process.argv.slice(2);
if (!stateFile || !documentId || !versionRaw) {
  console.error('usage: child.ts <stateFile> <documentId> <version> [confirmBeforeCrash]');
  process.exit(2);
}
const version = Number(versionRaw);
const confirmBeforeCrash = confirmBeforeCrashRaw === '1';

const prisma = new PrismaClient();
const chain = new FakeChainClient({ stateFile });
chain.onBroadcast = (txId) => {
  if (confirmBeforeCrash) chain.confirmTx(txId, 4242n);
  process.exit(9); // the scripted crash: the chain has the tx, our status write is lost
};
const content = new InMemoryDocumentContentProvider();
content.publish(documentId, version, { reportType: 'clinical-summary', anchoredIn: 'crash-test' });
const repo = new AnchorsRepository(prisma);
const service = new AnchorsService(content, chain, repo);
try {
  await service.anchorDocument(documentId, version);
} catch {
  // A timeout error may surface before the scripted exit; either way we die in the hook.
}
await prisma.$disconnect();
process.exit(0);
```

Hmm wait — the onBroadcast fires inside broadcast(); process.exit(9) — the surrounding try/catch is moot (exit is immediate). If the hook doesn't fire (shouldn't happen), exit 0 → the test asserts 9 and fails with the stderr. Note: top-level await in ESM tsx — fine.

Edge: the child's DATABASE_URL env — inherited from the test process. ✓.

Also, the child's PrismaClient connect: Prisma connects lazily on the first query (createIntent) — fine.

**API spec** (`test/api.spec.ts`):

```ts
process.env.CONFIRMATION_POLL_MS ??= '0';
process.env.RECOVERY_SWEEP_MS ??= '0';

describe('HTTP API', () => {
  let app: INestApplication; let h: Harness; let baseUrl: string;
  beforeAll(async () => {
    const chain = new FakeChainClient();
    const content = new InMemoryDocumentContentProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAIN_CLIENT).useValue(chain)
      .overrideProvider(DOCUMENT_CONTENT).useValue(content)
      .compile();
    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();
    const server = app.getHttpServer();
    await new Promise<void>(r => server.listen(0, () => r()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => { await app.close(); });
```

Hmm — `server.listen(0)` vs `app.listen(0)`: `app.listen(0)` then get the port via `app.getUrl()`? getUrl returns a string with a port. Simpler: `await app.listen(0); const url = await app.getUrl();` — getUrl may return http://[::1]:port or 0.0.0.0... I'll use the httpServer listen approach with an explicit callback and address(). `server.address()` returns AddressInfo | string | null → cast. OK.

Wait — overrideProvider on AppModule: the CHAIN_CLIENT token is provided by ChainModule (imported by AnchorsModule imported by AppModule) — the override works if the token is provided in the module tree. ✓.

Tests:
- POST /anchors → 202, body has documentId, version, txId, status 'BROADCAST_SENT', contentHash.
- POST /anchors duplicate → 409, envelope: `body.error.code === 'already_anchored'`, `typeof body.error.message === 'string'`, `body.error.details` is an object with existingTxId.
- POST /anchors missing document content → 404 envelope `resource_not_found`.
- POST /anchors with version: 'abc' → 400 envelope `invalid_request` (ValidationPipe → BadRequestException → filter).
- POST /anchors/verify with matching content (after confirm) → 200 result 'verified', proof.blockNumber is a string.
- POST /anchors/verify tampered → 200 'content_mismatch'.
- POST /anchors/verify no anchor → 200 'not_anchored'.
- POST /anchors/verify missing content field → 400 invalid_request.

Each test uses a fresh docId (uuid) to isolate. Publish the content first via the `content` provider instance (I hold the reference from beforeAll).

Wait — the content provider is created in the test (useValue) — yes, I hold the reference.

**Canonicalization spec** (`test/canonical-hash.spec.ts`):

```ts
describe('canonicalization', () => {
  it('is independent of key order, whitespace, and object construction order', () => {
    const a = { zeta: 1, alpha: { m: [1, 2.5, 'x'], b: null }, mid: true };
    const b = { alpha: { b: null, m: [1, 2.5, 'x'] }, mid: true, zeta: 1 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(canonicalHashOf(a)).toBe(canonicalHashOf(b));
  });
  it('sorts keys in code-unit order (not locale order)', () => {
    expect(canonicalizeJson({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
  });
  it('serializes numbers in shortest round-trip form and maps -0 to 0', () => {
    expect(canonicalizeJson({ n: 0.1 })).toBe('{"n":0.1}');
    expect(canonicalizeJson({ n: 1e21 })).toBe('{"n":1e+21}');
```

Wait — `String(1e21)` in JS: "1e+21"! Note: ECMAScript `String(1e21)` = "1e+21". And `JSON.stringify(1e21)` = "1e+21". Yes. So the assertion: `'{"n":1e+21}'`. And 0.1 → "0.1". -0: `String(-0)` = "0" → `canonicalizeJson({n:-0})` = '{"n":0}' equal to '{"n":0}'. ✓.

  it('escapes strings per JSON and leaves non-ASCII as UTF-8', () => {
    expect(canonicalizeJson({ s: 'a"b\\c\né' })).toBe('{"s":"a\\"b\\\\c\\né"}');
  });
  it('preserves array order', () => {
    expect(canonicalHashOf([1,2,3])).not.toBe(canonicalHashOf([3,2,1]));
  });
  it('hashes the UTF-8 bytes (hash differs from the hash of the escaped form)', ... maybe skip.
  it('rejects NaN, Infinity, -Infinity', () => { expect(() => canonicalizeJson({ n: NaN })).toThrow(CanonicalizationError); ... });
  it('rejects undefined', () => { expect(() => canonicalizeJson({ n: undefined })).toThrow(CanonicalizationError); });
```

Wait — `canonicalizeJson({ n: undefined })`: Object.keys returns ['n'], then the value undefined → typeof undefined → falls to the final throw ✓. But note: `{ n: undefined }` — Object.keys includes 'n' ✓.

  it('is deterministic across repeated runs (SHA-256 hex, lowercase, 64 chars)', () => {
    const h = canonicalHashOf(SAMPLE_CONTENT);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHashOf(SAMPLE_CONTENT)).toBe(h);
  });
});
```

**docs/canonicalization.md** — the written-out spec:

```md
# Canonicalization and content hashing for report anchoring

The structured JSON of a report version is the source of truth; the PDF is a rendering and plays no role in anchoring.
The on-chain anchor commits `sha256(canonical_bytes(content))`. This document is the normative definition: an auditor must be able to re-derive the canonical bytes from it alone.

## 1. Domain
The content must be a JSON value: object, array, string, number, boolean, or null. The following are rejected (canonicalization is not defined for them):
- undefined, symbols, functions
- non-finite numbers (NaN, +Infinity, −Infinity) — not representable in JSON

## 2. Canonical JSON serialization
- No whitespace.
- Objects: keys sorted in ascending UTF-16 code unit order (byte-wise lexicographic on the code units; locale-independent). Key duplication is not expressible.
- Arrays: element order preserved (positionally meaningful).
- Strings: escaped exactly as JSON requires: `"` → `\"`, `\` → `\\`, and control characters U+0000–U+001F (with the short forms `\b \f \n \r \t` where they exist). Characters U+007F and above are not escaped and appear in the output as-is.
- Numbers: serialized with ECMAScript Number::toString — the shortest string that round-trips exactly to the same IEEE-754 binary64 value (examples: 0.1 → "0.1", 100 → "100", 1e21 → "1e+21", 1.5e-7 → "1.5e-7"). −0 is serialized as "0" (−0 and 0 are numerically equal and indistinguishable).
- Literals: true, false, null as-is.

## 3. Encoding
The canonical byte string is the UTF-8 encoding of the canonical JSON string.

## 4. Hash
`content_hash = hex_lower( SHA-256( canonical_bytes ) )` — 64 lowercase hex characters.

## 5. On-chain payload
The anchored transaction payload is `{"kind":"report_anchor","documentId":…,"version":…,"contentHash":…}`; the chain client's prepare() is local and deterministic, so the same payload always yields the same txId — the re-broadcast path re-sends the stored signed transaction rather than re-preparing, so a resend cannot turn into a second anchor.
```

Good.

**Now — let me double-check the tricky parts**:

1. **Prisma Json column type**: `payload Json` — passing an AnchorTxPayload object ✓. Reading back: `row.payload` is `JsonValue` → cast.

2. **Prisma enum import**: my repository defines its own `AnchorStatusValue` union; the Prisma row's status is the Prisma enum type (a string union of the same literals) — assignable to my union? The Prisma-generated enum for `AnchorStatus`: `export const AnchorStatus = { PREPARED: 'PREPARED', ... } as const; export type AnchorStatus = (typeof AnchorStatus)[keyof typeof AnchorStatus];` → a union of literals ✓ assignable.

In the Prisma `where` clauses: `status: 'BROADCAST_SENT'` — the generated client types the where.status as the enum union; the string literal works ✓. `status: { in: ['PREPARED', 'OUTCOME_UNKNOWN'] }` ✓.

3. **BigInt in Prisma create/update**: blockNumber: receipt.blockNumber (bigint) ✓.

4. **`@@map("anchor_status")` on the enum** — is it supported? Yes, Prisma supports `@@map` on enums.

5. **Migration timestamp name**: `20250101000000_init` fine.

6. **uuid() default + the migration**: Prisma generates `DEFAULT (gen_random_uuid())` for `@default(uuid())` on postgres. I'll include that.

7. **Nest ESM + explicit .js extensions** — all relative imports with .js. ✓ (I'll double-check each file.)

8. **vitest + `@prisma/client`** — the client must be generated before tests; I'll add a script `"test": "prisma generate && vitest run"`? prisma generate requires the prisma CLI (devDep) and works offline (the generator is bundled). That makes tests self-contained. But the DB must exist + migrations applied. I'll add a script `"db:up": "prisma migrate deploy"` and note the requirement in the test header. Should I also add a `globalSetup` that checks DATABASE_URL and fails clearly? A small `test/setup.ts` global setup that verifies the env presence:

```ts
// vitest.config.ts
test: { setupFiles? no — globalSetup }
```
I'll skip the setup file; the PrismaClient constructor throws on connect if DATABASE_URL is missing — the error is visible. Keep it lean. Actually, a clear early failure is nicer... I'll keep it lean; the header comment states the requirement.

9. **`--import tsx`** — tsx as a devDependency. Also the child imports `@prisma/client` — resolvable from the project root ✓.

10. **process.exit(9) inside onBroadcast** — but note: the child's fake chain with a stateFile persists before onBroadcast ✓ (order in broadcast(): push → persist → onBroadcast → throw). ✓ The file is complete at the moment of death.

11. **The onBroadcast hook in the anchor spec** (the write-ahead proof) — the fake awaits it: `if (this.onBroadcast) await this.onBroadcast(txId);` — I'll type it `onBroadcast?: (txId: string) => void | Promise<void>`.

12. **ValidationPipe `forbidNonWhitelisted`** — with DTO properties defined, extra fields in the body → 400. Fine.

But wait: `@IsDefined() content!: unknown;` with `transform: true` — class-transformer will try to transform unknown... the content stays as-is (plain value). ✓. Also, whitelist keeps only declared properties ✓.

Edge: the body's `version` as number 1 ✓; as string "1" → @IsInt fails (with transform, "1" stays a string — transform: true only does class instances? `transform` enables implicit transformation of request body into class instances, but without `transformOptions: { enableImplicitConversion: true }`, strings are not converted to numbers). I'll keep strict: version must be a JSON number. Fine — the 400 test uses 'abc' (or 1.5) anyway.

13. **HttpException response in the filter**: for a ValidationPipe failure, the message is an array of constraint strings → join. details = the response object. ✓

14. **202 with `@HttpCode(HttpStatus.ACCEPTED)`** ✓.

15. **Controller mapping bigints**: toVerifyDto: proof.blockNumber → String(bigint). toAnchorDto: blockNumber → r.blockNumber === null ? null : String(r.blockNumber).

16. **`InMemoryDocumentContentProvider.publish`** — a test/demo helper on the stand-in; fine.

17. **AppModule** — imports: [AnchorsModule]. Nothing else. main.ts boots it.

18. **Logger import** from @nestjs/common ✓.

19. **rxjs** — a Nest peer dep (required for some features; harmless). I'll include it in deps (a @nestjs/common peer). Yes, include rxjs ^7.

20. **reflect-metadata** — must be imported before Nest decorators are evaluated — main.ts imports 'reflect-metadata' first; but do the test files import the app module before reflect-metadata? The @nestjs/common package itself imports reflect-metadata? Does Nest's @nestjs/common have reflect-metadata as a dep and import it? Actually, NestJS docs say to import 'reflect-metadata' in the entry; but with explicit @Inject tokens and no metadata needed... the decorators still execute (@Injectable registers metadata — needs the Reflect polyfill? @Injectable without emitDecoratorMetadata just stores metadata via Reflect.defineMetadata? It uses Reflect — with Node 20, global Reflect is native (no setMetadata). @Injectable() implementation: `Reflect.defineMetadata('__injectable__', true, target)` — works with native Reflect. @Inject stores tokens via defineMetadata. ValidationPipe etc. are fine. Nest's own modules import reflect-metadata at their entry (I think @nestjs/common's index re-exports from 'reflect-metadata'? not certain). To be safe: `import 'reflect-metadata'` in main.ts (first line) and in test files? The specs import @nestjs/testing, which imports @nestjs/core → @nestjs/common... I think modern @nestjs/common (v10+) imports reflect-metadata internally? Hmm, not certain. Safer: add `import 'reflect-metadata';` as the first line of each spec that boots Nest (the API spec), and in main.ts. Vitest handles it. Also the harness file? Only the API spec boots Nest. Add in main.ts + the API spec. Cheap insurance. (In Node 20, the reflect-metadata package is ESM/CJS interop — the import works.)

Actually — with vitest, `import 'reflect-metadata'` in main.ts: the API spec imports `configureApi` from '../src/main.js' — wait, main.ts imports AppModule → the whole tree, then the spec imports the config function — main's top-level runs the isMain check → false → no boot ✓, and the 'reflect-metadata' import in main.ts runs as a side effect when the spec imports main.ts ✓. Good — the API spec gets reflect-metadata transitively. But the other specs import src modules (service, repository) — do they need reflect-metadata? They use @Injectable/@Inject decorators — the decorator execution uses Reflect.defineMetadata — Node's native Reflect has no defineMetadata! Without the polyfill, `Reflect.defineMetadata` is undefined → crash?!

Hmm wait — @Injectable decorator implementation: in @nestjs/common, `Injectable()` returns a decorator that does `defineMetadata(INJECTABLE_WATERMARK, true, target)` — `defineMetadata` is imported from './metadata'... does Nest vendor a small metadata helper? Let me recall: @nestjs/common/decorators/core/injectable.decorator.ts:

```ts
import { InjectableOptions } from './interfaces/module-options.interface';
import { defineMetadata } from '../helpers';
export function Injectable(options?: InjectableOptions): ClassDecorator {
  return (target: Function) => {
    defineMetadata(INJECTABLE_WATERMARK, true, target);
    ...
  };
}
```
And `helpers.ts` (or metadata/):
```ts
import 'reflect-metadata';  // ← I think Nest does import reflect-metadata here!
```
Yes — I recall that @nestjs/common internally imports reflect-metadata (there's an explicit `import 'reflect-metadata'` in @nestjs/common/src/index or in the helpers). I'm fairly confident that NestJS bundles reflect-metadata imports internally (their docs' note about importing it in main is for older setups / for design:paramtypes with tsc). Either way, my deps list includes reflect-metadata and main.ts imports it. The specs import src files → import @nestjs/common → reflect-metadata is loaded. Safe.

21. **tsconfig "types": ["node"]** — @types/node devDep ✓. vitest globals? I'll import explicitly from 'vitest' (no globals config) ✓.

22. **package.json versions** — I'll use caret ranges for known-good majors:
- typescript ^5.5
- @nestjs/common ^10.4 (Nest 11 exists; 10 is battle-tested with Node 20; either fine — I'll pick ^10.4.15 for stability. Hmm, Nest 11 is current; but 10 works fine and is well known. I'll use ^10.)

Actually, let me use Nest 11 (^11.0.0) — Node 20+ is required, matches. Either is defensible; I'll pick 11.
- @prisma/client ^6, prisma ^6
- class-validator ^0.14, class-transformer ^0.5
- rxjs ^7.8
- reflect-metadata ^0.2
- vitest ^2 (or ^3; ^2 is stable) — I'll use ^2.1.0
- tsx ^4
- @types/node ^20
- @nestjs/testing ^11
- supertest — not used (fetch). Skip.

Scripts:
```json
{
  "prisma:generate": "prisma generate",
  "db:migrate": "prisma migrate deploy",
  "build": "prisma generate && tsc -p tsconfig.json",
  "start": "node dist/main.js",
  "dev": "tsx src/main.ts",
  "test": "prisma generate && vitest run",
  "test:watch": "vitest"
}
```

23. **`dev` script with tsx** — tsx resolves TS with ESM .js-extension imports? tsx handles .js → .ts resolution ✓.

24. **AnchorsService imports**: canonicalHashOf is defined in the same file ✓; the content provider type from '../content/document-content-provider.js'; the chain from '../chain/chain-client.js'; the repository from './anchors.repository.js'; errors from '../common/domain-error.js'.

25. **Repository imports**: PrismaClientKnownRequestError from '@prisma/client' — `import { Prisma } from '@prisma/client'; Prisma.PrismaClientKnownRequestError` ✓.

26. **VerifyResult type** — exported from the service file; the controller imports the type ✓.

27. **Controller toAnchorDto** — includes `payload`? No — the internal on-chain payload is not API surface (it's derivable). I'll exclude it. Include broadcastAttempts ✓, signedTx? No — that's internal material (the "signed tx" is somewhat sensitive; the txId is the identity). Exclude signedTx from the API. Hmm — auditors need txId + block ✓.

28. **findStuck ordering** — oldest first (createdAt asc) ✓, take limit.

29. **Sweep + worker double-processing a row**: both may see the same BROADCAST_SENT? The worker handles BROADCAST_SENT; the sweep handles PREPARED/OUTCOME_UNKNOWN — disjoint sets ✓.

30. **The crash test asserts the child's row is PREPARED** — the child dies in the broadcast hook; the status update never happens → PREPARED ✓. And the intent row exists (write-ahead) — the test asserts it: `row` is non-null. That's the core proof: after a crash, we have the row with the txId (the naive design would have no row). ✓ I'll assert `row !== null` explicitly with a message.

31. **The `countByDocumentVersion` repository method** ✓.

32. **Harness in test/harness.ts** — imports from src — with .js extensions ✓ (vitest handles TS with .js specifiers — vitest/vite resolves .js → .ts for TS files? Vite's resolver: for a TS file importing './x.js' where x.ts exists — does Vite handle that? Vitest uses Vite's TS resolution: I believe vitest resolves .js → .ts (esbuild/vite does this for TS files since Vite 4+? Actually Vite's resolver supports this: "TypeScript files can import with .js extension" — yes, Vite handles it (its `resolve` tries .ts for .js specifiers in TS projects). Vitest docs: "if you use TypeScript with Node16 module resolution, .js extension imports work." ✓ I've seen it work in vitest.)

33. **os.tmpdir state file + cleanup** ✓.

34. **spawn stdio + await close** — I'll collect stdout/stderr for debugging; assert exit code 9. Timeout: if the child hangs (DB down), the test hangs — I'll add a guard: `setTimeout(() => childProcess.kill('SIGKILL'), 60_000).unref()` and clear it. ✓

35. **The `verify` endpoint returns 200 even for not_anchored** — yes (a report, not an error).

36. **DomainError httpStatus on DocumentVersionNotFoundError** — 404 resource_not_found ✓.

37. **BroadcastRejectedError** (domain) vs BroadcastRejectionError (chain) — different names to avoid confusion ✓ (chain one has `.reason`).

38. **Service markOutcomeUnknown logging** — add a Logger in the service: `this.logger.warn(...)`. ✓

39. **The worker reads env per call** — I'll allow env changes in tests ✓ (the crash test doesn't need minAge env — it constructs the sweep directly, but minAge is read from env per sweepOnce! The crash test's row is fresh (just created by the child, seconds ago) → default minAge 5000 would skip it! I need to set RECOVERY_MIN_AGE_MS=0 in the recovery spec (top-level). ✓ I'll do that. And also set WORKER_BATCH_SIZE? Default 50 is fine.)

So at the top of `test/recovery.spec.ts`: `process.env.RECOVERY_MIN_AGE_MS = '0';` (an assignment, not ?=, to guarantee in that process).

40. **The API spec sets the poll env to '0'** — top-level `process.env.CONFIRMATION_POLL_MS = '0'; process.env.RECOVERY_SWEEP_MS = '0';` before importing? process.env is runtime; the onModuleInit runs at compile/init time — the assignment in the top-level of the module body runs before the test body, at import time — as long as it's at the top of the file (before beforeAll) ✓. Module evaluation order: the spec file body runs fully (including top-level statements) before hooks ✓.

41. **Prisma + multiple clients (harness + app + child)** — fine.

42. **`AppModule` — do we need to provide anything else?** No.

43. **`main.ts` PORT** — `Number(process.env.PORT ?? 3000)` ✓.

44. **The exception filter typing** — `catch(exception: unknown, host: ArgumentsHost)`. Express response structural type:

```ts
interface ExpressLikeResponse { status(code: number): { json(body: unknown): unknown }; }
const response = host.switchToHttp().getResponse<ExpressLikeResponse>();
```
getResponse<T>() generic exists ✓.

45. **details is never null** — always an object ✓. For unknown errors: details: { exceptionName, stack? } — I'll include { name, cause }? Keep { name: String } — hmm, details is "an object, never null" — content is free. I'll use `{ name, reason }`.

46. **404 on unknown routes** — Express's default 404? Nest without a global filter returns its own `{ statusCode: 404, message: 'Cannot POST ...' }` — but with a global @Catch() filter, Nest routes all exceptions including the final 404 handler? A global exception filter catches exceptions from the router; unknown routes → Nest's RouterExceptionFilter → I think the global filter does catch them (Nest applies global filters to all exceptions including 404 via the router). Yes — the global filter catches the NotFoundException Nest throws for unknown routes → envelope with resource_not_found ✓ (code via status mapping).

47. **`AnchorsService.anchorDocument` — content load before prepare** ✓ order: hash → prepare → persist → broadcast. The spec says compute hash, prepare, persist, broadcast ✓.

48. **What if prepare throws?** Local deterministic — no failure mode in the fake; if it did, the error propagates as internal. Fine.

49. **The `DuplicateAnchorError` flow when the existing row is in any status** — already_anchored with existingStatus in details ✓.

50. **The second call in the anchor spec** — the service prepares a tx (a second, identical txId since the payload is identical!) then createIntent → P2002 (the composite hits first; even if the tx_id index hits, my lookup handles it) → AlreadyAnchoredError ✓. Note: same content → same hash → same payload → same txId → the tx_id unique also violated — same row anyway. ✓

51. **Vitest include pattern** `test/**/*.spec.ts` ✓ (the crash child is `test/crash/child.ts` — not a spec ✓).

52. **hookTimeout** — the crash test spawn up to 60s; I'll set testTimeout/hookTimeout 90s ✓.

53. **tsconfig include only src** — the tests aren't type-checked by `tsc -p tsconfig.json` (fine; vitest transpiles without type-checking). Add a separate tsconfig for tests? Not necessary.

54. **ESM: `import { randomUUID } from 'node:crypto'`** ✓.

55. **The `FakeChainClient.prepare` stable stringify** — the payload: `{ kind, documentId, version, contentHash }` all strings/numbers.

```ts
function stableStringify(value: Record<string, string | number>): string {
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${typeof value[k] === 'string' ? JSON.stringify(value[k]) : String(value[k])}`).join(',')}}`;
}
```
Or simpler: `JSON.stringify(value, Object.keys(value).sort())` — JSON.stringify with an array replacer sorts keys! `JSON.stringify(obj, ['a','b'])` outputs keys in the replacer's order. Yes — that's a clean trick: `JSON.stringify(tx, Object.keys(tx).sort())`. ✓ I'll use that with a comment.

txId = '0x' + sha256 hex of that string ✓ deterministic.

56. **signedTx format** `fake-signed:${txId}` ✓; `txIdFromSignedTx` parses it.

57. **The fake `getReceipt` for an unknown txId** → null ✓.

58. **The recovery spec "stale PREPARED" case** — seed a PREPARED row: but wait, the sweep with minAge 0 picks it up; getReceipt null → broadcast the stored signedTx. Assert BROADCAST_SENT + signedTx matches ✓. This also proves the sweep can handle "crashed before broadcast call."

59. **Now — the API spec's envelope assertion for a validation error**: the body: `{ error: { code: 'invalid_request', message: [...joined], details: { statusCode, message: [...], error } } }` ✓.

60. **202 response body** — the anchor DTO ✓.

Let me also reconsider the route design once more. "endpoint: kebab-case, plural." `/anchors` (plural ✓), `/anchors/verify` (a verb-ish sub-route, kebab ✓). POST both. OK.

61. **The in-memory content provider stand-in in the AppModule** — via ContentModule's factory. But the API spec overrides it anyway. For `pnpm dev`, the API works but has no content (the in-memory starts empty) → 404 on anchoring. Acceptable as a stand-in; I'll comment.

62. **`AnchorsModule` imports PrismaModule, ChainModule, ContentModule** ✓ (wiring convention).

63. **Prisma module**: PrismaService is provided + exported ✓.

64. **Check the `Prisma.PrismaClientKnownRequestError` import path**: `import { Prisma } from '@prisma/client';` then `instanceof Prisma.PrismaClientKnownRequestError` ✓.

65. **BigInt comparison in the test**: `expect(row.blockNumber).toBe(77n)` — vitest handles bigint equality ✓.

66. **`confirmTx` default blockNumber param type** `bigint` ✓.

67. **The verify proof shape in the domain**: blockNumber bigint; the API maps to string ✓. In the service-level tests, I'll assert the bigint directly.

68. **The sample content in the harness** — exported from the harness ✓ used in specs.

69. **`canonicalizeJson` on a top-level array/number** — allowed ✓.

70. **`-0` in the doc** — I'll mention it.

71. **`String(1e21)` check** — JS: `String(1e21)` → "1e+21" ✓. And `JSON.stringify(1e21)` → "1e+21" — consistent with JSON. In my canonicalization I use String(number) — same result as JSON.stringify for numbers (both ECMAScript Number::toString) ✓.

72. **`String(0.000001)`** → "0.000001"; `String(1e-7)` → "1e-7". JSON.stringify(1e-7) → "1e-7" ✓ consistent.

73. **The child's import path for the repository/service** — `../../src/anchors/anchors.repository.js` from test/crash/ ✓.

74. **tsx + `--import` flag** — `node --import tsx test/crash/child.ts`? Hmm — `--import tsx` registers tsx's loader hook. Actually, tsx's docs: `node --import tsx ./file.ts` ✓ (tsx's README shows exactly `node --import tsx ./ts-file.ts`). ✓

75. **The child passes arguments after the script** ✓.

76. **Vitest ESM top-level await in the spec** — not needed (I'll use hooks).

77. **The crash child uses top-level await** — fine in ESM.

78. **The service's Logger** — `private readonly logger = new Logger(AnchorsService.name);` ✓.

79. **The filter catches `class-validator` errors?** The ValidationPipe throws a BadRequestException (HttpException) ✓ handled.

80. **`@Inject` import** — from '@nestjs/common' ✓ (re-exported from core? @Inject is exported from @nestjs/common ✓).

Now, the "role" naming for files I'm adding beyond the strict layout:
- `src/common/domain-error.ts` — shared error classes.
- `src/chain/chain-client.ts`, `src/chain/fake-chain-client.ts`, `src/chain/chain.module.ts`
- `src/content/document-content-provider.ts`, `src/content/content.module.ts`
- `src/prisma/prisma.module.ts`, `src/prisma/prisma.service.ts`
- `src/anchors/anchors.worker.ts`
- `test/harness.ts`, `test/crash/child.ts`

I think all are defensible. The naming `chain-client.ts` (no role suffix)... the convention example is `<feature>.<role>.ts` for feature files; contract files for non-feature modules can just be kebab-case. I'll accept.

Hmm, wait — the layout convention shows `src/<feature>/<feature>.module.ts` — so the anchors feature files: `anchors.module.ts`, `anchors.controller.ts`, `anchors.service.ts`, `anchors.repository.ts` ✓ all match. Plus `anchors.worker.ts` ✓ (worker is a role).

Let me double-check: **the convention "the controller validates input and calls the service. Zero business logic."** — my controller maps the DTO (already validated by the pipe) and calls the service; the response DTO mapping is presentation ✓ not business logic.

**"The service holds the logic. Zero raw SQL, zero Prisma client calls."** — the service uses the repository ✓ (the canonicalization + hash is logic ✓).

**"The repository is the only layer that touches the database."** — the workers use only the repository ✓. Tests use PrismaClient directly in the harness — tests are exempt (they're not app layers). ✓

Now, let me write the `toRecord` mapping:

```ts
private toRecord(row: AnchorModel): AnchorRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    contentHash: row.contentHash,
    txId: row.txId,
    signedTx: row.signedTx,
    payload: row.payload as AnchorTxPayload,
    status: row.status,
    broadcastAttempts: row.broadcastAttempts,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    updatedAt: row.updatedAt,
  };
}
```
`import type { Anchor } from '@prisma/client';` — the generated model type name `Anchor` ✓. `status: row.status` — the Prisma enum → my union: is the generated `AnchorStatus` type assignable to `'PREPARED' | ...`? The generated type is exactly that literal union ✓.

Wait — the model name `Anchor` and my TS type `AnchorRecord` ✓ no clash.

**Repository createIntent data**: the Prisma create data wants `status` default ✓ omitted; `broadcastAttempts` default 0 ✓ omitted. payload: Json ✓.

**markConfirmed input**: I'll pass the whole ChainReceipt (import type from the chain module) ✓.

Now, the **verify result type** — let me write it concretely:

```ts
export interface AnchorProof { txId: string; blockNumber: bigint; blockHash: string; }

export type VerifyReport =
  | {
      result: 'verified';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: 'CONFIRMED';
      proof: AnchorProof;
      failureReason: null;
    }
  | {
      result: 'content_mismatch';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: AnchorStatusValue;
      proof: null;
      failureReason: string | null;
    }
  | {
      result: 'not_anchored';
      documentId: string;
      version: number;
      expectedHash: null;
      actualHash: string;
      anchorStatus: null;
      proof: null;
      failureReason: null;
    }
  | {
      result: 'pending';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: 'PREPARED' | 'BROADCAST_SENT' | 'OUTCOME_UNKNOWN';
      proof: null;
      txId: string;
      failureReason: null;
    }
  | {
      result: 'anchor_failed';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: 'FAILED';
      proof: null;
      txId: string;
      failureReason: string;
    };
```

The controller toVerifyDto: map to the API shape with blockNumber as string:

```ts
type VerifyReportDto = the same union but with proof: { txId: string; blockNumber: string; blockHash: string } | null;
```
I'll implement a single mapper:

```ts
private toVerifyDto(v: VerifyReport) {
  const base = { documentId: v.documentId, version: v.version, result: v.result, expectedHash: v.expectedHash, actualHash: v.actualHash, anchorStatus: v.anchorStatus, failureReason: v.failureReason };
  ...
}
```
Simpler: build it with a switch:

```ts
switch (v.result) {
  case 'verified':
    return { ...v, proof: { txId: v.proof.txId, blockNumber: v.proof.blockNumber.toString(), blockHash: v.proof.blockHash } };
  default:
    return { ...v, proof: null, ...(('txId' in v) ? { txId: v.txId } : {}) };
}
```
TS narrows the union ✓. The spread of the union member is fine.

**AnchorDto**:

```ts
export interface AnchorDto {
  id: string; documentId: string; version: number; contentHash: string; txId: string;
  status: AnchorStatusValue; broadcastAttempts: number;
  blockNumber: string | null; blockHash: string | null; failureReason: string | null;
  createdAt: string; confirmedAt: string | null; updatedAt: string;
}
```

Mapper:
```ts
private toAnchorDto(r: AnchorRecord): AnchorDto {
  return {
    id: r.id, documentId: r.documentId, version: r.version, contentHash: r.contentHash, txId: r.txId,
    status: r.status, broadcastAttempts: r.broadcastAttempts,
    blockNumber: r.blockNumber === null ? null : r.blockNumber.toString(),
    blockHash: r.blockHash, failureReason: r.failureReason,
    createdAt: r.createdAt.toISOString(), confirmedAt: r.confirmedAt === null ? null : r.confirmedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
```

Now the **API spec** — one concern: `Test.createTestingModule({ imports: [AppModule] })` — AppModule is a class with @Module metadata ✓.

Another: the app boots PrismaService → onModuleInit `$connect` → needs DB ✓ (test env has it).

And the worker: AnchorWorkersService's onModuleInit reads env (set to 0) → no timers ✓. app.close() → onModuleDestroy ✓.

**Potential issue: two PrismaClients connecting (the app's + the harness's)** — fine.

Let me also think about whether the **`markBroadcastSent` on re-broadcast in the sweep increments the attempts** — yes, via increment 1 ✓ (OUTCOME_UNKNOWN → BROADCAST_SENT: attempts +1).

**The initial anchor flow**: createIntent (attempts 0) → broadcast ok → markBroadcastSent (attempts 1) ✓.

Now — let me also reconsider **whether `anchorDocument` should return the record on the timeout path**: yes, with status OUTCOME_UNKNOWN (202). The caller learns the txId immediately — good UX and matches "the tx identity exists before the broadcast."

**Edge — the second anchor attempt after FAILED**: AlreadyAnchoredError with existingStatus 'FAILED' — the message can say "use a new version." I'll add to details: `hint`? Keep details: { documentId, version, existingTxId, existingStatus }. The message mentions enforcement. Fine.

**Let me write the migration filename**: `prisma/migrations/20250101000000_init/migration.sql`. The convention "every schema change ships with a migration" ✓. I should also include the `prisma/migrations/migration_lock.toml`! Prisma requires the lock file:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```
Yes — include it.

Now let me re-examine the **fake chain's file persistence format** and the receipt blockNumber string round-trip:

StoredReceipt { outcome, blockNumber: string, blockHash, failureReason? }.
confirmTx(txId, blockNumber: bigint = 1000n): store `blockNumber: blockNumber.toString()` ✓.
getReceipt: `BigInt(stored.blockNumber)` ✓.

**The child's confirmBeforeCrash path**: onBroadcast: `chain.confirmTx(txId, 4242n)` — writes to the file (persist) ✓ then exit(9) ✓.

**The parent's sweep for the confirmFirst case**: getReceipt → confirmed (block 4242) → markConfirmed; broadcastCount 1 ✓ "no re-broadcast."

I'll write both crash variants in the spec (two `it`s) — reuse the spawn helper (a local function in the spec).

Also — an important detail: the parent constructs `chain2 = new FakeChainClient({ stateFile })` after the child has exited — reads the latest state ✓.

**The child's DATABASE_URL** — inherited ✓.

**The child's exit code on unexpected errors** — unhandled rejection → exit 1 → the test fails with the stderr ✓ (assert 9).

Now, the **harness** file:

```ts
import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { AnchorsService } from '../src/anchors/anchors.service.js';
import { ConfirmationWorkerService, RecoverySweepService } from '../src/anchors/anchors.worker.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../src/content/document-content-provider.js';

export interface Harness {
  prisma: PrismaClient;
  chain: FakeChainClient;
  content: InMemoryDocumentContentProvider;
  repo: AnchorsRepository;
  service: AnchorsService;
  confirmation: ConfirmationWorkerService;
  sweep: RecoverySweepService;
}

export function createHarness(): Harness { ... }

export async function disposeHarness(h: Harness): Promise<void> { await h.prisma.$disconnect(); }

export const SAMPLE_CONTENT = {
  reportType: 'clinical-summary',
  subject: 'Patient 000-1234',
  vitals: { heartRate: 72, spo2: 0.98, notes: 'stable, no intervention required' },
  sections: ['admission', 'course', 'discharge'],
  metadata: { author: 'dr. ávila', unit: 'ICU-3', reviewed: true },
};
```

Note: the harness imports the worker file → the AnchorWorkersService class is also exported — the harness doesn't instantiate it ✓.

Now — one more thing about **`process.env.RECOVERY_MIN_AGE_MS = '0'` at the top of recovery.spec.ts** — the spec files may run in parallel (vitest default: files in parallel, separate workers/processes) → env per process ✓ no cross-contamination.

**Vitest pool** — default 'forks'? Vitest 2's default pool: 'forks'. Each file a separate process ✓ env isolation ✓.

**The API spec + other specs in parallel, hitting the same DB** — isolated by uuid docIds ✓. The unique constraint on txId: each (doc,version) has a unique hash → unique txId ✓ no cross-test collisions. Wait — could two tests anchor the same content under different docIds? The payload includes documentId → different txId ✓.

Now, **the `verify` service's canonicalization error** → InvalidContentError (400) — via the API. At the service level, the test asserts the code. ✓

Let me also settle the **error envelope mapping for BroadcastRejectedError in the API** — 502, code 'broadcast_rejected' ✓.

I think the design is solid. Let me also double-check the **`AnchorsService` constructor param order** (used by the `new` in the child): (content, chain, repo) ✓ the child passes in that order.

**Repository constructor**: (prisma) ✓.

**Workers constructors**: (repo, chain) ✓.

Now — **write the canonicalization doc + comment** — the doc file is normative; the code comment references it.

One more consideration — **the `payload` Json and the tx identity**: the "anchor intent" includes txId + signedTx + payload + hash ✓ committed before the broadcast ✓.

**Let me draft each file mentally, then output.**

---

`package.json`:

```json
{
  "name": "report-anchoring",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Versioned report anchoring on an L2: write-ahead anchor intents, confirmation worker, recovery sweep, and verification.",
  "engines": { "node": ">=20" },
  "scripts": {
    "prisma:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "test": "prisma generate && vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@prisma/client": "^6.2.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.0.0",
    "@types/node": "^20.17.0",
    "prisma": "^6.2.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

---

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

---

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
```

---

`prisma/schema.prisma` — as above.

---

`prisma/migrations/migration_lock.toml`:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

---

`prisma/migrations/20250101000000_init/migration.sql` — as above.

---

`docs/canonicalization.md` — the full written-out spec.

---

`src/prisma/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`src/prisma/prisma.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

---

`src/chain/chain-client.ts`:

```ts
/**
 * The chain client contract. The production L2 client implements this; this
 * repository ships without real keys or RPC, so the wired default is a fake
 * (src/chain/fake-chain-client.ts).
 *
 * prepare() is local and deterministic: the same payload always yields the same
 * { txId, signedTx }. The transaction identity therefore exists before the
 * broadcast does — the anchor intent persists it ahead of broadcast().
 */

export const CHAIN_CLIENT = 'CHAIN_CLIENT';

export interface AnchorTxPayload {
  kind: 'report_anchor';
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface ChainReceipt {
  txId: string;
  outcome: 'confirmed' | 'failed';
  blockNumber: bigint;
  blockHash: string;
  failureReason?: string;
}

export interface ChainClient {
  prepare(tx: AnchorTxPayload): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

/** The broadcast call timed out: the chain may or may not have the transaction. Never treated as sent, never as failed. */
export class BroadcastTimeoutError extends Error {
  constructor(message = 'broadcast timed out; chain outcome unknown') {
    super(message);
    this.name = 'BroadcastTimeoutError';
  }
}

/** The node definitively rejected the transaction (validation failure, not a timeout): the tx is not on the chain. */
export class BroadcastRejectionError extends Error {
  constructor(readonly reason: string) {
    super(`broadcast rejected by node: ${reason}`);
    this.name = 'BroadcastRejectionError';
  }
}
```

---

`src/chain/fake-chain-client.ts`:

```ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AnchorTxPayload, BroadcastRejectionError, BroadcastTimeoutError, ChainClient, ChainReceipt, PreparedTx } from './chain-client.js';

interface BroadcastLogEntry { txId: string; signedTx: string; at: string; }
interface StoredReceipt { outcome: 'confirmed' | 'failed'; blockNumber: string; blockHash: string; failureReason?: string; }
interface FakeChainState { broadcasts: BroadcastLogEntry[]; receipts: Record<string, StoredReceipt>; }

export type ScriptedBroadcastOutcome = 'ok' | 'timeout' | 'timeout-not-landed' | 'reject';

/**
 * A deterministic fake of the chain client.
 *
 * The state (broadcast log + receipts) lives in memory by default; pass `stateFile`
 * to persist it to disk so it survives a process restart — modelling the fact that a
 * real chain's state is external to any one process. That is what the crash-recovery
 * test relies on: the child process "dies" after the fake chain has accepted the
 * transaction, and the restarted process sees the same chain state.
 */
export class FakeChainClient implements ChainClient {
  private readonly state: FakeChainState;
  private readonly stateFile: string | undefined;
  private scripted: ScriptedBroadcastOutcome[] = [];
  private rejectionReason = 'simulated node rejection';

  /** Called after the fake chain has accepted a broadcast. Tests may use this to kill the process mid-flight. */
  onBroadcast?: (txId: string) => void | Promise<void>;

  constructor(options: { stateFile?: string } = {}) {
    this.stateFile = options.stateFile;
    this.state = options.stateFile && existsSync(options.stateFile)
      ? (JSON.parse(readFileSync(options.stateFile, 'utf8')) as FakeChainState)
      : { broadcasts: [], receipts: {} };
  }

  /** Queue the outcome of the next broadcast(s). Default (no script) is 'ok'. */
  scriptBroadcast(outcome: ScriptedBroadcastOutcome, rejectionReason?: string): void {
    this.scripted.push(outcome);
    if (rejectionReason) this.rejectionReason = rejectionReason;
  }

  get broadcastLog(): readonly BroadcastLogEntry[] { return this.state.broadcasts; }

  broadcastCountFor(txId: string): number {
    return this.state.broadcasts.filter((b) => b.txId === txId).length;
  }

  /** Simulate chain inclusion with a success outcome. */
  confirmTx(txId: string, blockNumber: bigint = 1_000n): void {
    this.state.receipts[txId] = {
      outcome: 'confirmed',
      blockNumber: blockNumber.toString(),
      blockHash: `0x${sha256Hex(`${txId}:block:${blockNumber}`)}`,
    };
    this.persist();
  }

  /** Simulate chain inclusion with a failure outcome (the tx is in a block but failed). */
  failTx(txId: string, failureReason = 'transaction reverted', blockNumber: bigint = 1_000n): void {
    this.state.receipts[txId] = {
      outcome: 'failed',
      blockNumber: blockNumber.toString(),
      blockHash: `0x${sha256Hex(`${txId}:block:${blockNumber}`)}`,
      failureReason,
    };
    this.persist();
  }

  async prepare(tx: AnchorTxPayload): Promise<PreparedTx> {
    // Local and deterministic: the same payload always produces the same identity.
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const txId = `0x${sha256Hex(canonical)}`;
    return { txId, signedTx: `fake-signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const outcome = this.scripted.shift() ?? 'ok';
    const txId = this.txIdFromSignedTx(signedTx);
    if (outcome === 'timeout-not-landed') {
      // The request was lost in flight: the chain has no record of it.
      throw new BroadcastTimeoutError();
    }
    // The chain accepted the transaction. Acceptance happens regardless of whether
    // the response to us arrives (that is the timeout case).
    this.state.broadcasts.push({ txId, signedTx, at: new Date().toISOString() });
    this.persist();
    if (this.onBroadcast) await this.onBroadcast(txId);
    if (outcome === 'timeout') throw new BroadcastTimeoutError();
    if (outcome === 'reject') throw new BroadcastRejectionError(this.rejectionReason);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    const stored = this.state.receipts[txId];
    if (!stored) return null;
    return {
      txId,
      outcome: stored.outcome,
      blockNumber: BigInt(stored.blockNumber),
      blockHash: stored.blockHash,
      ...(stored.failureReason !== undefined ? { failureReason: stored.failureReason } : {}),
    };
  }

  private txIdFromSignedTx(signedTx: string): string {
    const prefix = 'fake-signed:';
    return signedTx.startsWith(prefix) ? signedTx.slice(prefix.length) : '0xunknown';
  }

  private persist(): void {
    if (this.stateFile) writeFileSync(this.stateFile, JSON.stringify(this.state));
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
```

Wait — `JSON.stringify(tx, Object.keys(tx).sort())` — the replacer array: keys not in the array are dropped; order follows the array ✓. tx has exactly those keys ✓.

---

`src/chain/chain.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CHAIN_CLIENT } from './chain-client.js';
import { FakeChainClient } from './fake-chain-client.js';

@Module({
  providers: [
    // No real keys or RPC in this build: the fake is the wired chain client.
    // A production L2 client implements the same ChainClient contract and
    // replaces this factory.
    { provide: CHAIN_CLIENT, useFactory: () => new FakeChainClient() },
  ],
  exports: [CHAIN_CLIENT],
})
export class ChainModule {}
```

---

`src/content/document-content-provider.ts`:

```ts
import { DomainError } from '../common/domain-error.js';

/**
 * The source of the structured content of a published report version.
 * The structured JSON is the source of truth; the PDF is only a rendering.
 * ASSUMPTION: anchorDocument(documentId, version) takes no content parameter, so
 * the structured content must come from a port; the platform's report store
 * implements it in production, and the in-memory stand-in below wires this
 * self-contained build.
 */
export const DOCUMENT_CONTENT = 'DOCUMENT_CONTENT';

export interface DocumentContentProvider {
  /**
   * @throws DocumentVersionNotFoundError when the (document, version) has no published content.
   */
  getContent(documentId: string, version: number): Promise<unknown>;
}

export class DocumentVersionNotFoundError extends DomainError {
  constructor(documentId: string, version: number) {
    super(
      'resource_not_found',
      404,
      `No published report content for document ${documentId}, version ${version}`,
      { documentId, version },
    );
  }
}

/** Development stand-in for the report store (see the assumption above). */
export class InMemoryDocumentContentProvider implements DocumentContentProvider {
  private readonly content = new Map<string, unknown>();

  publish(documentId: string, version: number, content: unknown): void {
    this.content.set(key(documentId, version), content);
  }

  async getContent(documentId: string, version: number): Promise<unknown> {
    const value = this.content.get(key(documentId, version));
    if (value === undefined) throw new DocumentVersionNotFoundError(documentId, version);
    return value;
  }
}

function key(documentId: string, version: number): string {
  return `${documentId}@${version}`;
}
```

`src/content/content.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DOCUMENT_CONTENT, InMemoryDocumentContentProvider } from './document-content-provider.js';

@Module({
  providers: [{ provide: DOCUMENT_CONTENT, useFactory: () => new InMemoryDocumentContentProvider() }],
  exports: [DOCUMENT_CONTENT],
})
export class ContentModule {}
```

---

`src/common/domain-error.ts`:

```ts
/**
 * Errors with an API contract. Each carries the fields of the single error
 * envelope: a snake_case `code` (the contract), a developer-facing `message`,
 * and `details` (an object, never null).
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AlreadyAnchoredError extends DomainError {
  constructor(documentId: string, version: number, existingTxId: string, existingStatus: string) {
    super(
      'already_anchored',
      409,
      `Document ${documentId} version ${version} is already anchored; exactly one anchor per (document, version) is enforced by the database. Republish as a new version instead.`,
      { documentId, version, existingTxId, existingStatus },
    );
  }
}

export class InvalidContentError extends DomainError {
  constructor(reason: string) {
    super('invalid_content', 400, `Report content is not canonicalizable: ${reason}`, { reason });
  }
}

export class BroadcastRejectedError extends DomainError {
  constructor(txId: string, reason: string) {
    super('broadcast_rejected', 502, `The chain node rejected the anchor transaction: ${reason}`, { txId, reason });
  }
}
```

---

`src/anchors/anchors.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Anchor, Prisma } from '@prisma/client';
import { AnchorTxPayload } from '../chain/chain-client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AnchorStatusValue = 'PREPARED' | 'BROADCAST_SENT' | 'OUTCOME_UNKNOWN' | 'CONFIRMED' | 'FAILED';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  payload: AnchorTxPayload;
  status: AnchorStatusValue;
  broadcastAttempts: number;
  blockNumber: bigint | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date;
}

export interface CreateAnchorIntent {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  payload: AnchorTxPayload;
}

/** Raised when the unique (document_id, version) constraint rejects an insert. */
export class DuplicateAnchorError extends Error {
  constructor(readonly existing: AnchorRecord) {
    super(`An anchor already exists for document ${existing.documentId}, version ${existing.version}`);
    this.name = 'DuplicateAnchorError';
  }
}

@Injectable()
export class AnchorsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Persists the anchor intent (status PREPARED). The unique (document_id, version) constraint is the enforcer of "one anchor per version." */
  async createIntent(input: CreateAnchorIntent): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.anchor.create({ data: input });
      return this.toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.anchor.findUnique({
          where: { documentId_version: { documentId: input.documentId, version: input.version } },
        });
        if (existing) throw new DuplicateAnchorError(this.toRecord(existing));
      }
      throw error;
    }
  }

  async findByDocumentVersion(documentId: string, version: number): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? this.toRecord(row) : null;
  }

  async countByDocumentVersion(documentId: string, version: number): Promise<number> {
    return this.prisma.anchor.count({ where: { documentId, version } });
  }

  /** Anchors that the node accepted (BROADCAST_SENT) and the confirmation worker must poll for receipts. */
  async findBroadcastSent(limit: number): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: 'BROADCAST_SENT' },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  /** Anchors stuck in broadcast limbo: PREPARED (crashed before or during the first broadcast) or OUTCOME_UNKNOWN (the broadcast timed out). */
  async findStuck(olderThanMs: number, limit: number): Promise<AnchorRecord[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.prisma.anchor.findMany({
      where: {
        status: { in: ['PREPARED', 'OUTCOME_UNKNOWN'] },
        updatedAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async markBroadcastSent(id: string): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { status: 'BROADCAST_SENT', broadcastAttempts: { increment: 1 } },
    });
    return this.toRecord(row);
  }

  async markOutcomeUnknown(id: string): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { status: 'OUTCOME_UNKNOWN', broadcastAttempts: { increment: 1 } },
    });
    return this.toRecord(row);
  }

  async markConfirmed(id: string, receipt: { blockNumber: bigint; blockHash: string }): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { status: 'CONFIRMED', blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, confirmedAt: new Date() },
    });
    return this.toRecord(row);
  }

  async markFailed(id: string, failureReason: string): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { status: 'FAILED', failureReason },
    });
    return this.toRecord(row);
  }

  private toRecord(row: Anchor): AnchorRecord {
    return {
      id: row.id,
      documentId: row.documentId,
      version: row.version,
      contentHash: row.contentHash,
      txId: row.txId,
      signedTx: row.signedTx,
      payload: row.payload as AnchorTxPayload,
      status: row.status,
      broadcastAttempts: row.broadcastAttempts,
      blockNumber: row.blockNumber,
      blockHash: row.blockHash,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

Check: `where: { status: 'BROADCAST_SENT' }` — typed ✓. `status: row.status` — the Prisma `AnchorStatus` → AnchorStatusValue ✓.

`markConfirmed` param type: I'll take `ChainReceipt`? The receipt has extra fields; a structural subset is fine. I'll import the type from the chain: `ChainReceipt`. Use it for clarity:

```ts
import type { ChainReceipt } from '../chain/chain-client.js';
async markConfirmed(id: string, receipt: ChainReceipt): Promise<AnchorRecord>
```
✓

---

`src/anchors/anchors.service.ts`:

The big one. Let me write it:

```ts
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AnchorTxPayload,
  BroadcastRejectionError,
  ChainClient,
  CHAIN_CLIENT,
} from '../chain/chain-client.js';
import {
  DocumentContentProvider,
  DOCUMENT_CONTENT,
} from '../content/document-content-provider.js';
import { AlreadyAnchoredError, InvalidContentError, BroadcastRejectedError } from '../common/domain-error.js';
import { AnchorsRepository, AnchorRecord, DuplicateAnchorError } from './anchors.repository.js';

/* ------------------------------------------------------------------ */
/* Canonicalization — the normative definition of the content hash.   */
/* Written out for auditors in docs/canonicalization.md; the code     */
/* below is that definition.                                          */
/* ------------------------------------------------------------------ */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(`canonicalization failed: ${message}`);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Serializes a JSON value into its canonical form:
 * - no whitespace;
 * - object keys sorted in ascending UTF-16 code unit order (locale-independent);
 * - array order preserved;
 * - strings escaped exactly as JSON requires; non-ASCII written as-is (UTF-8 on the wire);
 * - numbers in ECMAScript shortest round-trip form (`String(n)`); -0 serializes as `0`;
 * - rejects undefined, symbols, functions, and non-finite numbers.
 */
export function canonicalizeJson(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError(`the number ${String(value)} is not finite and has no JSON form`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`).join(',')}}`;
  }
  throw new CanonicalizationError(`a value of type ${typeof value} is not a JSON value`);
}

/** content_hash = lowercase hex SHA-256 of the canonical bytes (UTF-8 of the canonical form). */
export function canonicalHashOf(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
}

/* ------------------------------------------------------------------ */

export interface AnchorProof {
  txId: string;
  blockNumber: bigint;
  blockHash: string;
}

export type VerifyReport =
  | { result: 'verified'; documentId: string; version: number; expectedHash: string; actualHash: string; anchorStatus: 'CONFIRMED'; proof: AnchorProof; failureReason: null }
  | { result: 'content_mismatch'; documentId: string; version: number; expectedHash: string; actualHash: string; anchorStatus: AnchorStatusValue; proof: null; failureReason: string | null }
  | { result: 'not_anchored'; documentId: string; version: number; expectedHash: null; actualHash: string; anchorStatus: null; proof: null; failureReason: null }
  | { result: 'pending'; documentId: string; version: number; expectedHash: string; actualHash: string; anchorStatus: 'PREPARED' | 'BROADCAST_SENT' | 'OUTCOME_UNKNOWN'; proof: null; txId: string; failureReason: null }
  | { result: 'anchor_failed'; documentId: string; version: number; expectedHash: string; actualHash: string; anchorStatus: 'FAILED'; proof: null; txId: string; failureReason: string };

@Injectable()
export class AnchorsService {
  private readonly logger = new Logger(AnchorsService.name);

  constructor(
    @Inject(DOCUMENT_CONTENT) private readonly contentProvider: DocumentContentProvider,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(AnchorsRepository) private readonly anchors: AnchorsRepository,
  ) {}

  /**
   * Anchors the structured content of a published (document, version).
   *
   * Order matters (the write-ahead fix):
   *   1. hash the canonical content
   *   2. prepare() — the tx identity exists here, before any broadcast
   *   3. persist the anchor intent (with txId and the signed tx) and commit
   *   4. only then broadcast
   *
   * The unique (document_id, version) constraint makes a second anchor for the same
   * version impossible at the schema level.
   */
  async anchorDocument(documentId: string, version: number): Promise<AnchorRecord> {
    const content = await this.contentProvider.getContent(documentId, version);
    const contentHash = this.hashOrReject(content);

    const payload: AnchorTxPayload = { kind: 'report_anchor', documentId, version, contentHash };
    const prepared = await this.chain.prepare(payload);

    let record: AnchorRecord;
    try {
      record = await this.anchors.createIntent({
        documentId,
        version,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
        payload,
      });
    } catch (error) {
      if (error instanceof DuplicateAnchorError) {
        throw new AlreadyAnchoredError(documentId, version, error.existing.txId, error.existing.status);
      }
      throw error;
    }

    try {
      // The node accepted the transaction. Acceptance is not confirmation:
      // the state moves to BROADCAST_SENT and only a receipt (via the confirmation worker) can move it to CONFIRMED.
      await this.chain.broadcast(prepared.signedTx);
      return await this.anchors.markBroadcastSent(record.id);
    } catch (error) {
      if (error instanceof BroadcastRejectionError) {
        // Definitive rejection: the tx is not on the chain. The row is FAILED and the
        *slot remains occupied: re-anchor the same version by republishing a new version.
        await this.anchors.markFailed(record.id, error.reason);
        throw new BroadcastRejectedError(prepared.txId, error.reason);
      }
      // Timeout or any other error: the outcome is unknown. We never collapse it into
      // sent or failed — the recovery sweep will ask the chain first.
      this.logger.warn(`broadcast outcome unknown for document ${documentId} v${version} (txId=${prepared.txId}): ${error instanceof Error ? error.message : String(error)}`);
      return await this.anchors.markOutcomeUnknown(record.id);
    }
  }

  /**
   * Verifies the supplied content against the anchor for (document, version):
   * recomputes the canonical hash and returns either the anchoring proof
   * (txId, block) or a report of why the anchor cannot be asserted.
   */
  async verify(documentId: string, version: number, content: unknown): Promise<VerifyReport> {
    const actualHash = this.hashOrReject(content);
    const record = await this.anchors.findByDocumentVersion(documentId, version);

    if (!record) {
      return { result: 'not_anchored', documentId, version, expectedHash: null, actualHash, anchorStatus: null, proof: null, failureReason: null };
    }
    if (actualHash !== record.contentHash) {
      return { result: 'content_mismatch', documentId, version, expectedHash: record.contentHash, actualHash, anchorStatus: record.status, proof: null, failureReason: record.failureReason };
    }
    switch (record.status) {
      case 'CONFIRMED':
        return {
          result: 'verified',
          documentId,
          version,
          expectedHash: record.contentHash,
          actualHash,
          anchorStatus: record.status,
          proof: { txId: record.txId, blockNumber: record.blockNumber ?? 0n, blockHash: record.blockHash ?? '' },
          failureReason: null,
        };
      case 'FAILED':
        return { result: 'anchor_failed', documentId, version, expectedHash: record.contentHash, actualHash, anchorStatus: record.status, proof: null, txId: record.txId, failureReason: record.failureReason ?? 'unknown failure' };
      default:
        return { result: 'pending', documentId, version, expectedHash: record.contentHash, actualHash, anchorStatus: record.status, proof: null, txId: record.txId, failureReason: null };
    }
  }

  private hashOrReject(content: unknown): string {
    try {
      return canonicalHashOf(content);
    } catch (error) {
      if (error instanceof CanonicalizationError) throw new InvalidContentError(error.message);
      throw error;
    }
  }
}
```

Wait — the `AnchorStatusValue` type is referenced in VerifyReport — I need to import it from the repository: `import { AnchorsRepository, AnchorRecord, AnchorStatusValue, DuplicateAnchorError } from './anchors.repository.js';` ✓.

The `blockNumber ?? 0n` fallback — a CONFIRMED row always has a block (the repository only sets it in markConfirmed) — the `?? 0n` is just for type safety. OK.

Typo check: `*slot` — I wrote `*slot remains` — that's a comment: "// slot remains occupied" (fix the stray asterisk).

---

`src/anchors/anchors.worker.ts`:

```ts
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BroadcastRejectionError, ChainClient, CHAIN_CLIENT } from '../chain/chain-client.js';
import { AnchorsRepository } from './anchors.repository.js';

/**
 * Confirmation worker: polls receipts for BROADCAST_SENT anchors and advances their state.
 * Confirmation comes only from a receipt — never from a broadcast() return.
 */
@Injectable()
export class ConfirmationWorkerService {
  constructor(
    @Inject(AnchorsRepository) private readonly anchors: AnchorsRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  /** One poll cycle. Returns the number of anchors advanced. */
  async pollOnce(): Promise<number> {
    const rows = await this.anchors.findBroadcastSent(batchSize());
    let advanced = 0;
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      if (receipt.outcome === 'confirmed') {
        await this.anchors.markConfirmed(row.id, receipt);
      } else {
        await this.anchors.markFailed(row.id, receipt.failureReason ?? 'transaction failed on chain');
      }
      advanced += 1;
    }
    return advanced;
  }
}

/**
 * Recovery sweep for anchors stuck in broadcast limbo (PREPARED or OUTCOME_UNKNOWN).
 *
 * Chain first: always getReceipt(txId) before doing anything else. If the tx landed,
 * we confirm (or fail) it from the receipt and never re-broadcast. Only if the chain
 * has no trace is the same stored signed transaction re-broadcast — the same one,
 * never a freshly prepared one — so a resend cannot turn into a second anchor.
 */
@Injectable()
export class RecoverySweepService {
  constructor(
    @Inject(AnchorsRepository) private readonly anchors: AnchorsRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  /** One sweep cycle. Returns the number of anchors processed. */
  async sweepOnce(): Promise<number> {
    const rows = await this.anchors.findStuck(recoveryMinAgeMs(), batchSize());
    let processed = 0;
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        if (receipt.outcome === 'confirmed') {
          await this.anchors.markConfirmed(row.id, receipt);
        } else {
          await this.anchors.markFailed(row.id, receipt.failureReason ?? 'transaction failed on chain');
        }
        processed += 1;
        continue;
      }
      // No trace on the chain: re-broadcast the same signed transaction.
      try {
        await this.chain.broadcast(row.signedTx);
        await this.anchors.markBroadcastSent(row.id);
      } catch (error) {
        if (error instanceof BroadcastRejectionError) {
          await this.anchors.markFailed(row.id, error.reason);
        } else {
          // Still unknown; the next sweep asks the chain again.
          await this.anchors.markOutcomeUnknown(row.id);
        }
      }
      processed += 1;
    }
    return processed;
  }
}

/**
 * Starts the background loops. Intervals come from environment configuration only;
 * a value of 0 disables the loop (used by tests, which drive pollOnce()/sweepOnce() directly).
 */
@Injectable()
export class AnchorWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorWorkersService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(ConfirmationWorkerService) private readonly confirmationWorker: ConfirmationWorkerService,
    @Inject(RecoverySweepService) private readonly recoverySweep: RecoverySweepService,
  ) {}

  onModuleInit(): void {
    const confirmationPollMs = Number(process.env.CONFIRMATION_POLL_MS ?? 2000);
    const recoverySweepMs = Number(process.env.RECOVERY_SWEEP_MS ?? 10000);

    if (confirmationPollMs > 0) {
      this.timers.push(setInterval(() => {
        void this.runCycle('confirmation worker', () => this.confirmationWorker.pollOnce());
      }, confirmationPollMs));
    }
    if (recoverySweepMs > 0) {
      this.timers.push(setInterval(() => {
        void this.runCycle('recovery sweep', () => this.recoverySweep.sweepOnce());
      }, recoverySweepMs));
    }
    this.logger.log(`workers started (CONFIRMATION_POLL_MS=${confirmationPollMs || 'off'}, RECOVERY_SWEEP_MS=${recoverySweepMs || 'off'})`);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private runCycle(name: string, cycle: () => Promise<number>): void {
    cycle()
      .then((count) => { if (count > 0) this.logger.log(`${name}: processed ${count} anchor(s)`); })
      .catch((error: unknown) => {
        this.logger.error(`${name} cycle failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      });
  }
}

function batchSize(): number {
  const value = Number(process.env.WORKER_BATCH_SIZE ?? 50);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50;
}

function recoveryMinAgeMs(): number {
  const value = Number(process.env.RECOVERY_MIN_AGE_MS ?? 5000);
  return Number.isFinite(value) && value >= 0 ? value : 5000;
}
```

---

`src/anchors/anchors.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { IsDefined, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { AnchorRecord } from './anchors.repository.js';
import { AnchorsService, AnchorProof, VerifyReport } from './anchors.service.js';

export class AnchorCreateDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsInt()
  @Min(1)
  version!: number;
}

export class VerifyAnchorDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsInt()
  @Min(1)
  version!: number;

  // The structured content to recompute the hash from. Any JSON value; must be present.
  @IsDefined()
  content!: unknown;
}

export interface AnchorDto {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  status: AnchorRecord['status'];
  broadcastAttempts: number;
  blockNumber: string | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

export type VerifyReportDto = {
  result: VerifyReport['result'];
  documentId: string;
  version: number;
  expectedHash: string | null;
  actualHash: string;
  anchorStatus: VerifyReport['anchorStatus'];
  proof: { txId: string; blockNumber: string; blockHash: string } | null;
  txId?: string;
  failureReason: string | null;
};

@Controller('anchors')
export class AnchorsController {
  constructor(@Inject(AnchorsService) private readonly service: AnchorsService) {}

  /**
   * POST /anchors — anchor the structured content of a published (document, version).
   * 202: the intent (with the tx identity) is committed; confirmation happens asynchronously
   * from the receipt via the confirmation worker.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async anchorDocument(@Body() body: AnchorCreateDto): Promise<AnchorDto> {
    const record = await this.service.anchorDocument(body.documentId, body.version);
    return toAnchorDto(record);
  }

  /**
   * POST /anchors/verify — recompute the hash from the supplied content and return the
   * anchoring proof (txId, block) or a mismatch report saying what differs.
   */
  @Post('verify')
  async verify(@Body() body: VerifyAnchorDto): Promise<VerifyReportDto> {
    const report = await this.service.verify(body.documentId, body.version, body.content);
    return toVerifyReportDto(report);
  }
}

function toAnchorDto(record: AnchorRecord): AnchorDto {
  return {
    id: record.id,
    documentId: record.documentId,
    version: record.version,
    contentHash: record.contentHash,
    txId: record.txId,
    status: record.status,
    broadcastAttempts: record.broadcastAttempts,
    blockNumber: record.blockNumber === null ? null : record.blockNumber.toString(),
    blockHash: record.blockHash,
    failureReason: record.failureReason,
    createdAt: record.createdAt.toISOString(),
    confirmedAt: record.confirmedAt === null ? null : record.confirmedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toVerifyReportDto(report: VerifyReport): VerifyReportDto {
  const base: VerifyReportDto = {
    result: report.result,
    documentId: report.documentId,
    version: report.version,
    expectedHash: report.expectedHash,
    actualHash: report.actualHash,
    anchorStatus: report.anchorStatus,
    proof: null,
    failureReason: report.failureReason,
  };
  if (report.result === 'verified') {
    base.proof = {
      txId: report.proof.txId,
      blockNumber: report.proof.blockNumber.toString(),
      blockHash: report.proof.blockHash,
    };
  }
  if ('txId' in report) {
    base.txId = report.txId;
  }
  return base;
}
```

Hmm — the `AnchorProof` import is unused if I inline the type — I'll drop that import.

`VerifyReport['anchorStatus']` — a union of 'CONFIRMED' | AnchorStatusValue | null | ... — fine.

---

`src/anchors/anchors.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module.js';
import { ContentModule } from '../content/content.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchorsController } from './anchors.controller.js';
import { AnchorsRepository } from './anchors.repository.js';
import { AnchorsService } from './anchors.service.js';
import { AnchorWorkersService, ConfirmationWorkerService, RecoverySweepService } from './anchors.worker.js';

@Module({
  imports: [PrismaModule, ChainModule, ContentModule],
  controllers: [AnchorsController],
  providers: [AnchorsRepository, AnchorsService, ConfirmationWorkerService, RecoverySweepService, AnchorWorkersService],
})
export class AnchorsModule {}
```

---

`src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AnchorsModule } from './anchors/anchors.module.js';

@Module({
  imports: [AnchorsModule],
})
export class AppModule {}
```

---

`src/main.ts`:

```ts
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DomainError } from './common/domain-error.js';

/**
 * The single error envelope for the whole API:
 *   { "error": { "code": "<snake_case>", "message": "...", "details": {} } }
 * `code` is the contract; `message` is developer-facing; `details` is an object, never null.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ExpressLikeResponse>();
    const { status, code, message, details } = this.classify(exception);
    if (status >= 500) {
      this.logger.error(`unhandled error: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`);
    }
    response.status(status).json({ error: { code, message, details } });
  }

  private classify(exception: unknown): { status: number; code: string; message: string; details: Record<string, unknown> } {
    if (exception instanceof DomainError) {
      return { status: exception.httpStatus, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { status, code: codeForStatus(status), message: payload, details: {} };
      }
      const body = payload as Record<string, unknown>;
      const message = typeof body.message === 'string'
        ? body.message
        : Array.isArray(body.message)
          ? (body.message as unknown[]).join('; ')
          : exception.message;
      return { status, code: codeForStatus(status), message, details: body };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: exception instanceof Error ? exception.message : 'Unexpected error',
      details: { name: exception instanceof Error ? exception.name : 'Unknown' },
    };
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'invalid_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'resource_not_found';
    case 409:
      return 'already_anchored';
    default:
      return 'http_error';
  }
}

interface ExpressLikeResponse {
  status(code: number): { json(body: unknown): unknown };
}

/** Wires the global validation and the single error envelope. Shared by the server and the tests. */
export function configureApi(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiErrorFilter());
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApi(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`report-anchoring API listening on :${port}`, 'Bootstrap');
}

// Run only when this file is the entry point (tests import configureApi from here).
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void bootstrap();
}
```

Check: `import.meta.url` in main.ts compiled with NodeNext → ✓ ESM.

`exception instanceof HttpException` — Nest's HttpException ✓. Note: DomainError extends Error (not HttpException) ✓ checked first.

---

Now the **tests**.

`test/harness.ts` — as drafted. Also export a helper `anchorAndConfirm`? The verify spec needs the confirmed state: I'll write it inline.

`test/canonical-hash.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canonicalHashOf, canonicalizeJson, CanonicalizationError } from '../src/anchors/anchors.service.js';
import { SAMPLE_CONTENT } from './harness.js';

describe('canonicalization', () => {
  it('is independent of key order and construction order', () => {
    const a = { zeta: 1, alpha: { m: [1, 2.5, 'x'], b: null }, mid: true };
    const b = { alpha: { b: null, m: [1, 2.5, 'x'] }, mid: true, zeta: 1 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(canonicalHashOf(a)).toBe(canonicalHashOf(b));
  });

  it('sorts keys in UTF-16 code-unit order, which is locale-independent', () => {
    expect(canonicalizeJson({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
  });

  it('emits no whitespace and escapes strings per JSON', () => {
    expect(canonicalizeJson({ s: 'a"b\\c\né', empty: [] })).toBe('{"empty":[],"s":"a\\"b\\\\c\\né"}');
  });

  it('serializes numbers in shortest round-trip form and normalizes -0 to 0', () => {
    expect(canonicalizeJson({ n: 0.1 })).toBe('{"n":0.1}');
    expect(canonicalizeJson({ n: 1e21 })).toBe('{"n":1e+21}');
    expect(canonicalizeJson({ n: -0 })).toBe('{"n":0}');
  });

  it('preserves array order (position is significant)', () => {
    expect(canonicalHashOf([1, 2, 3])).not.toBe(canonicalHashOf([3, 2, 1]));
  });

  it('rejects non-finite numbers, undefined, symbols, and functions', () => {
    expect(() => canonicalizeJson({ n: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: Number.POSITIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: Number.NEGATIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson(Symbol('x'))).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ f: () => 1 })).toThrow(CanonicalizationError);
  });

  it('produces a stable lowercase 64-char SHA-256 hex digest over the UTF-8 canonical bytes', () => {
    const first = canonicalHashOf(SAMPLE_CONTENT);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHashOf(SAMPLE_CONTENT)).toBe(first);
    // A byte difference (an accented character) must change the digest.
    const ascii = { ...SAMPLE_CONTENT, metadata: { ...SAMPLE_CONTENT.metadata, author: 'dr. avila' } };
    expect(canonicalHashOf(ascii)).not.toBe(first);
  });
});
```

Check the escaping assertion: input string: `a"b\c\né` (with an actual newline). JSON.stringify → `"a\"b\\c\né"` → the string in source code: `'{"empty":[],"s":"a\\"b\\\\c\\né"}'` — let me verify char by char. The canonical output for the object `{ s: 'a"b\\c\né', empty: [] }` — key order sorted: 'empty' < 's' ✓ so `{"empty":[],"s":"..."}`. The string content: `a"b` + backslash + `c` + newline + `é`. JSON.stringify escaping: `a\"b\\c\né` (with a literal backslash sequence in the output: a, \", b, \\, c, \n, é). The expected string in TS source: `'{"empty":[],"s":"a\\"b\\\\c\\né"}'` → TS unescaping: `{"empty":[],"s":"a\"b\\c\né"}` where `\n` in the TS source is an actual newline?? No — in the expected TS literal I wrote `\\n` → that's backslash + n (two characters) ✓ matching the JSON escape sequence. And `é` as-is ✓. The `\\"` in the TS source → `\"` ✓. `\\\\` → `\\` ✓. So the expected = `{"empty":[],"s":"a\"b\\c\né"}` (with the 2-character escape sequences). And the actual canonical = JSON.stringify of the value → same ✓. Good.

SAMPLE_CONTENT.metadata.author is 'dr. ávila' → the ascii variant 'dr. avila' → different byte → different hash ✓.

`test/anchor.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BroadcastRejectedError, InvalidContentError, DocumentVersionNotFoundError } from '../src/common/domain-error.js'; // wait DocumentVersionNotFoundError is in the content file
```

DocumentVersionNotFoundError from '../src/content/document-content-provider.js' ✓. BroadcastRejectionError (chain) is not needed in the spec; the domain BroadcastRejectedError is needed.

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlreadyAnchoredError, BroadcastRejectedError, InvalidContentError } from '../src/common/domain-error.js';
import { DocumentVersionNotFoundError } from '../src/content/document-content-provider.js';
import { createHarness, disposeHarness, Harness, SAMPLE_CONTENT } from './harness.js';
import { AnchorRecord } from '../src/anchors/anchors.repository.js';

describe('anchorDocument', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, SAMPLE_CONTENT);
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  it('persists the intent with the tx identity before the broadcast, then broadcasts exactly once', async () => {
    let rowAtBroadcastTime: AnchorRecord | null = null;
    h.chain.onBroadcast = async (txId) => {
      // The fake chain has just accepted the tx: at this instant, what does our database say?
      rowAtBroadcastTime = await h.repo.findByDocumentVersion(documentId, 1);
      expect(txId).toMatch(/^0x[0-9a-f]{64}$/);
    };

    const record = await h.service.anchorDocument(documentId, 1);

    // Write-ahead: the intent was already committed before the chain saw the transaction.
    expect(rowAtBroadcastTime).not.toBeNull();
    expect(rowAtBroadcastTime!.status).toBe('PREPARED');
    expect(rowAtBroadcastTime!.txId).toBe(record.txId);
    expect(rowAtBroadcastTime!.signedTx).toBe(record.signedTx);

    // After the node accepted, the state is BROADCAST_SENT — not CONFIRMED.
    expect(record.status).toBe('BROADCAST_SENT');
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('rejects a second anchor for the same (document, version) — enforced by the database, not by app logic', async () => {
    const first = await h.service.anchorDocument(documentId, 1);

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'already_anchored',
      httpStatus: 409,
      details: { existingTxId: first.txId, existingStatus: 'BROADCAST_SENT' },
    });

    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(1);
  });

  it('lands in OUTCOME_UNKNOWN when the broadcast times out — distinct from sent and from failed', async () => {
    h.chain.scriptBroadcast('timeout');

    const record = await h.service.anchorDocument(documentId, 1);

    expect(record.status).toBe('OUTCOME_UNKNOWN');
    expect(record.txId).toMatch(/^0x[0-9a-f]{64}$/);
    // The chain did accept the tx (the timeout is only on the response).
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('marks the anchor FAILED and surfaces broadcast_rejected when the node definitively rejects', async () => {
    h.chain.scriptBroadcast('reject', 'invalid signature');

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'broadcast_rejected',
      httpStatus: 502,
    });

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('FAILED');
    expect(row!.failureReason).toBe('invalid signature');
  });

  it('returns resource_not_found when the version has no published content, without creating an anchor', async () => {
    await expect(h.service.anchorDocument(documentId, 42)).rejects.toThrow(DocumentVersionNotFoundError);
    expect(await h.repo.countByDocumentVersion(documentId, 42)).toBe(0);
  });

  it('refuses non-canonicalizable content before touching the chain or the database', async () => {
    h.content.publish(documentId, 1, { score: Number.NaN });

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toThrow(InvalidContentError);

    expect(h.chain.broadcastLog).toHaveLength(0);
    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(0);
  });
});
```

`rejects.toMatchObject` with a class instance — the error is an object with code/httpStatus/details properties ✓ toMatchObject works on error objects (they're objects) ✓.

`test/verify.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalHashOf } from '../src/anchors/anchors.service.js';
import { createHarness, disposeHarness, Harness, SAMPLE_CONTENT } from './harness.js';

describe('verify', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, SAMPLE_CONTENT);
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  async function anchorAndConfirm(blockNumber = 12_345n) {
    const record = await h.service.anchorDocument(documentId, 1);
    h.chain.confirmTx(record.txId, blockNumber);
    await h.confirmation.pollOnce();
    return record;
  }

  it('returns the anchoring proof (txId, block) for matching content', async () => {
    const record = await anchorAndConfirm(4321n);

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    expect(report.result).toBe('verified');
    expect(report.proof).toEqual({
      txId: record.txId,
      blockNumber: 4321n,
      blockHash: expect.stringMatching(/^0x[0-9a-f]+$/),
    });
    expect(report.expectedHash).toBe(canonicalHashOf(SAMPLE_CONTENT));
    expect(report.actualHash).toBe(report.expectedHash);
  });

  it('reports a content mismatch with both hashes when the supplied content differs', async () => {
    await anchorAndConfirm();
    const tampered = { ...SAMPLE_CONTENT, sections: [...SAMPLE_CONTENT.sections].reverse() };

    const report = await h.service.verify(documentId, 1, tampered);

    expect(report.result).toBe('content_mismatch');
    expect(report.expectedHash).toBe(canonicalHashOf(SAMPLE_CONTENT));
    expect(report.actualHash).toBe(canonicalHashOf(tampered));
    expect(report.actualHash).not.toBe(report.expectedHash);
    expect(report.proof).toBeNull();
  });

  it('reports not_anchored when the version has no anchor', async () => {
    const report = await h.service.verify(documentId, 7, SAMPLE_CONTENT);

    expect(report.result).toBe('not_anchored');
    expect(report.expectedHash).toBeNull();
    expect(report.proof).toBeNull();
  });

  it('reports pending with the tx identity when the anchor is not yet confirmed', async () => {
    const record = await h.service.anchorDocument(documentId, 1);

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    expect(report.result).toBe('pending');
    expect(report.txId).toBe(record.txId);
    expect(report.proof).toBeNull();
  });

  it('prefers the mismatch report over anchor state when the hash differs', async () => {
    await h.service.anchorDocument(documentId, 1); // pending, never confirmed
    const tampered = { ...SAMPLE_CONTENT, vitals: { ...SAMPLE_CONTENT.vitals, heartRate: 99 } };

    const report = await h.service.verify(documentId, 1, tampered);

    expect(report.result).toBe('content_mismatch');
  });

  it('reports anchor_failed with the reason when the anchor failed on chain', async () => {
    h.chain.failTx? — hmm: to get a FAILED row: script a broadcast rejection.
  });
```

For the failed case:
```ts
  it('reports anchor_failed with the reason when the anchor failed on chain', async () => {
    h.chain.scriptBroadcast('reject', 'insufficient funds');
    let recordTxId: string;
    await h.service.anchorDocument(documentId, 1).then(
      (r) => { recordTxId = r.txId; },
      (e) => { throw e; },
    ); — no: the rejection throws. Capture:
    const row = ... after catch:
    
    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({ code: 'broadcast_rejected' });
    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);
    expect(report.result).toBe('anchor_failed');
    expect(report.failureReason).toBe('insufficient funds');
    expect(report.proof).toBeNull();
  });
```
✓ simpler.

TS narrowing: `report.txId` on the pending union — I access after checking result === 'pending'? In the test, `report.result` is a literal after expect — TS doesn't narrow from expect. `report.txId` — does txId exist on all members? verified has no txId property! Accessing `report.txId` on a union that lacks it on one member → TS error. In the test: `expect(report.txId)` — TS: property 'txId' does not exist on type '{ result: "verified"; ... }'. Need narrowing:

```ts
if (report.result !== 'pending') throw new Error(`expected pending, got ${report.result}`);
expect(report.txId).toBe(record.txId);
```
The guard narrows ✓. Similarly for `report.proof` — exists on all members ✓. `report.failureReason` is on all ✓. `report.expectedHash` is on all ✓.

In the 'verified' test: `report.proof` is non-null on the verified member but null on others — `expect(report.proof).toEqual({...})` — the type is `AnchorProof | null` ✓ fine.

In the mismatch test: `report.actualHash` ✓ present on all.

OK.

`test/recovery.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { execFile? no — spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net'; (not needed here)
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { ConfirmationWorkerService, RecoverySweepService } from '../src/anchors/anchors.worker.js';
import { canonicalHashOf } from '../src/anchors/anchors.service.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { createHarness, disposeHarness, Harness } from './harness.js';

// The crash test sweeps rows that were created milliseconds ago.
process.env.RECOVERY_MIN_AGE_MS = '0';

describe('recovery sweep and confirmation worker', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, { reportType: 'clinical-summary' });
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  it('confirms from the receipt when the broadcast timed out but landed — no re-broadcast', async () => {
    h.chain.scriptBroadcast('timeout');
    const record = await h.service.anchorDocument(documentId, 1);
    expect(record.status).toBe('OUTCOME_UNKNOWN');

    h.chain.confirmTx(record.txId, 77n);
    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('CONFIRMED');
    expect(row!.blockNumber).toBe(77n);
    expect(row!.confirmedAt).toBeInstanceOf(Date);
    // The receipt settled it: the sweep must not re-broadcast.
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('re-broadcasts the same signed tx when the chain has no trace, and ends with one anchor and one tx identity', async () => {
    h.chain.scriptBroadcast('timeout-not-landed');
    const record = await h.service.anchorDocument(documentId, 1);
    expect(record.status).toBe('OUTCOME_UNKNOWN');
    expect(h.chain.broadcastLog).toHaveLength(0); // the chain really has no trace

    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(row!.broadcastAttempts).toBe(2);
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
    expect(h.chain.broadcastLog[0]!.signedTx).toBe(record.signedTx); // the same signed tx, not a new one

    h.chain.confirmTx(record.txId, 88n);
    await h.confirmation.pollOnce();

    expect((await h.repo.findByDocumentVersion(documentId, 1))!.status).toBe('CONFIRMED');
    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(1);
    expect(new Set(h.chain.broadcastLog.map((b) => b.txId)).size).toBe(1);
  });

  it('broadcasts a stale PREPARED anchor (crashed before the broadcast call) without a second identity', async () => {
    const content = { reportType: 'clinical-summary' };
    const contentHash = canonicalHashOf(content);
    const prepared = await h.chain.prepare({ kind: 'report_anchor', documentId, version: 1, contentHash });
    await h.repo.createIntent({ documentId, version: 1, contentHash, txId: prepared.txId, signedTx: prepared.signedTx, payload: { kind: 'report_anchor', documentId, version: 1, contentHash } });

    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(h.chain.broadcastLog[0]!.signedTx).toBe(prepared.signedTx);
    expect(h.chain.broadcastCountFor(prepared.txId)).toBe(1);
  });

  it('marks FAILED when the sweep finds a failed receipt', async () => {
    h.chain.scriptBroadcast('timeout');
    const record = await h.service.anchorDocument(documentId, 1);
    h.chain.failTx(record.txId, 'reverted: anchor slot busy', 99n);
    await h.sweep.sweepOnce();
    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('FAILED');
    expect(row!.failureReason).toBe('reverted: anchor slot busy');
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1); // no re-broadcast once the receipt exists
  });
```

Wait — the 'stale PREPARED' test: content is published? I publish in beforeEach with `{ reportType: 'clinical-summary' }` and use the same object here — consistent, though the row is seeded directly (no service). Fine. Actually the beforeEach content is unused in this test — OK.

Now the crash tests. A local helper:

```ts
  const childScript = fileURLToPath(new URL('./crash/child.ts', import.meta.url));

  function runCrashChild(stateFile: string, docId: string, confirmBeforeCrash: boolean): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx', childScript, stateFile, docId, '1', confirmBeforeCrash ? '1' : '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const watchdog = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('close', (code) => {
        clearTimeout(watchdog);
        resolve({ code: code ?? -1, stderr });
      });
    });
  }
```

Crash test 1 (no receipt at crash time):

```ts
  it('crash between broadcast and status update: the restarted app recovers from the chain, one anchor, one tx identity', async () => {
    const stateFile = join(tmpdir(), `fake-chain-${randomUUID()}.json`);
    const crashDocId = `doc-${randomUUID()}`;
    try {
      const { code, stderr } = await runCrashChild(stateFile, crashDocId, false);
      expect(code, `child should die with the scripted exit code 9, stderr: ${stderr}`).toBe(9);

      // Restart: fresh services, the same (file-backed) chain.
      const chain = new FakeChainClient({ stateFile });
      const repo = new AnchorsRepository(h.prisma);
      const sweep = new RecoverySweepService(repo, chain);
      const confirmation = new ConfirmationWorkerService(repo, chain);

      // The write-ahead intent survived the crash: the row exists with the tx identity,
      // and it is still PREPARED because the crash ate the status update.
      const rowAtRestart = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowAtRestart, 'the anchor intent must have been committed before the crash').not.toBeNull();
      expect(rowAtRestart!.status).toBe('PREPARED');
      const { txId, signedTx } = rowAtRestart!;

      // The chain accepted the tx before the crash: exactly one broadcast, no receipt.
      expect(chain.broadcastCountFor(txId)).toBe(1);
      expect(chain.broadcastLog[0]!.signedTx).toBe(signedTx);

      // Recovery asks the chain first: no receipt yet, so it re-broadcasts the same signed tx.
      await sweep.sweepOnce();
      const rowAfterSweep = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowAfterSweep!.status).toBe('BROADCAST_SENT');
      expect(rowAfterSweep!.txId).toBe(txId); // the identity was never re-prepared
      expect(chain.broadcastCountFor(txId)).toBe(2);
      expect(chain.broadcastLog[1]!.signedTx).toBe(signedTx); // the same signed tx, not a new one

      // The tx lands; the confirmation worker confirms from the receipt.
      chain.confirmTx(txId, 555n);
      await confirmation.pollOnce();
      const rowFinal = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowFinal!.status).toBe('CONFIRMED');
      expect(rowFinal!.blockNumber).toBe(555n);

      // Exactly one anchor and one transaction identity.
      expect(await repo.countByDocumentVersion(crashDocId, 1)).toBe(1);
      expect(new Set(chain.broadcastLog.map((b) => b.txId)).size).toBe(1);
    } finally {
      rmSync(stateFile, { force: true });
    }
  });
```

Crash test 2 (the chain confirmed before the crash):

```ts
  it('crash after the chain already confirmed: the sweep confirms from the receipt without re-broadcasting', async () => {
    const stateFile = join(tmpdir(), `fake-chain-${randomUUID()}.json`);
    const crashDocId = `doc-${randomUUID()}`;
    try {
      const { code, stderr } = await runCrashChild(stateFile, crashDocId, true);
      expect(code, `child should die with the scripted exit code 9, stderr: ${stderr}`).toBe(9);

      const chain = new FakeChainClient({ stateFile });
      const repo = new AnchorsRepository(h.prisma);
      const sweep = new RecoverySweepService(repo, chain);

      const row = await repo.findByDocumentVersion(crashDocId, 1);
      expect(row).not.toBeNull();
      expect(row!.status).toBe('PREPARED');

      await sweep.sweepOnce();

      const rowFinal = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowFinal!.status).toBe('CONFIRMED');
      expect(rowFinal!.blockNumber).toBe(4242n);
      expect(chain.broadcastCountFor(row!.txId)).toBe(1); // no re-broadcast: the receipt settled it
      expect(await repo.countByDocumentVersion(crashDocId, 1)).toBe(1);
    } finally {
      rmSync(stateFile, { force: true });
    }
  });
```

Check: `expect(code, message)` — vitest's expect supports a message as the 2nd arg ✓.

`chain.broadcastLog[0]!` — noUncheckedIndexedAccess? My tsconfig is strict — strict doesn't include noUncheckedIndexedAccess (it's separate). Vitest doesn't type-check anyway. But tsc builds only src (tests are excluded) — so test TS strictness isn't enforced by the build. Still, I'll write clean code; I'll add `!` where needed for editor cleanliness. Fine.

`test/api.spec.ts`:

```ts
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApi } from '../src/main.js';
import { CHAIN_CLIENT } from '../src/chain/chain-client.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { DOCUMENT_CONTENT, InMemoryDocumentContentProvider } from '../src/content/document-content-provider.js';

// The tests drive the workers directly; keep the background loops off.
process.env.CONFIRMATION_POLL_MS = '0';
process.env.RECOVERY_SWEEP_MS = '0';

const SAMPLE = { reportType: 'clinical-summary', vitals: { heartRate: 72, spo2: 0.98 } };

describe('HTTP API', () => {
  let app: INestApplication;
  let baseUrl: string;
  const chain = new FakeChainClient();
  const content = new InMemoryDocumentContentProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAIN_CLIENT)
      .useValue(chain)
      .overrideProvider(DOCUMENT_CONTENT)
      .useValue(content)
      .compile();
    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as any };
  }
```

`body: any` — eslint isn't set up; TS strict allows any with an explicit annotation ✓. I'll type it loosely:

```ts
type Envelope = { error: { code: string; message: string; details: Record<string, unknown> } };
```
I'll use `any` sparingly.

Tests:

```ts
  it('POST /anchors returns 202 with the anchor intent and its tx identity', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    const { status, body } = await post('/anchors', { documentId, version: 1 });

    expect(status).toBe(202);
    expect(body.documentId).toBe(documentId);
    expect(body.version).toBe(1);
    expect(body.txId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.status).toBe('BROADCAST_SENT');
    expect(typeof body.contentHash).toBe('string');
  });

  it('POST /anchors on an already-anchored version returns the 409 already_anchored envelope from the database constraint', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    await post('/anchors', { documentId, version: 1 });
    const { status, body } = await post('/anchors', { documentId, version: 1 });

    expect(status).toBe(409);
    expect(body.error.code).toBe('already_anchored');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toBeTypeOf('object');
    expect(body.error.details.existingStatus).toBe('BROADCAST_SENT');
  });

  it('POST /anchors without published content returns the 404 resource_not_found envelope', async () => {
    const { status, body } = await post('/anchors', { documentId: `doc-${randomUUID()}`, version: 3 });

    expect(status).toBe(404);
    expect(body.error.code).toBe('resource_not_found');
    expect(body.error.details).toEqual(expect.objectContaining({ version: 3 }));
  });

  it('POST /anchors with an invalid version returns the 400 invalid_request envelope', async () => {
    const { status, body } = await post('/anchors', { documentId: `doc-${randomUUID()}`, version: 'not-an-int' });

    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
    expect(Array.isArray(body.error.details.message)).toBe(true);
  });

  it('POST /anchors/verify returns the proof with a string block number for matching content', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    const anchored = await post('/anchors', { documentId, version: 1 });
    chain.confirmTx(anchored.body.txId, 777n);
    // Drive the confirmation worker directly (the background loop is off in tests).
    const moduleRef = ... — hmm, the worker service instance: I can get it from the app:
    const confirmation = app.get(ConfirmationWorkerService);
    await confirmation.pollOnce();

    const { status, body } = await post('/anchors/verify', { documentId, version: 1, content: SAMPLE });

    expect(status).toBe(200);
    expect(body.result).toBe('verified');
    expect(body.proof.txId).toBe(anchored.body.txId);
    expect(body.proof.blockNumber).toBe('777');
    expect(typeof body.proof.blockHash).toBe('string');
  });

  it('POST /anchors/verify returns a mismatch report naming both hashes for differing content', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);
    await post('/anchors', { documentId, version: 1 });

    const tampered = { ...SAMPLE, vitals: { ...SAMPLE.vitals, heartRate: 99 } };
    const { status, body } = await post('/anchors/verify', { documentId, version: 1, content: tampered });

    expect(status).toBe(200);
    expect(body.result).toBe('content_mismatch');
    expect(body.expectedHash).not.toBe(body.actualHash);
  });

  it('POST /anchors/verify reports not_anchored for a version that was never anchored', async () => {
    const { status, body } = await post('/anchors/verify', { documentId: `doc-${randomUUID()}`, version: 1, content: SAMPLE });

    expect(status).toBe(200);
    expect(body.result).toBe('not_anchored');
    expect(body.expectedHash).toBeNull();
    expect(body.proof).toBeNull();
  });

  it('POST /anchors/verify requires the content field', async () => {
    const { status, body } = await post('/anchors/verify', { documentId: `doc-${randomUUID()}`, version: 1 });

    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
  });
});
```

`app.get(ConfirmationWorkerService)` — import from the worker file ✓.

Wait — `chain.confirmTx(anchored.body.txId, 777n)` — `anchored.body.txId` is any ✓.

One concern: the `verify` test — the worker is obtained via app.get — the same repository instance as the service (the module graph) ✓ the chain is the overridden fake ✓.

Also — the fetch response for 409: the body is parsed as JSON ✓ (the filter outputs JSON).

**The `Envelope` details check for validation**: the ValidationPipe's BadRequestException response: `{ statusCode: 400, message: [ 'version must be an integer number', ... ], error: 'Bad Request' }` → the filter: code 'invalid_request', message joined, details = that object ✓ `details.message` is an array ✓.

Now the **crash child** — let me double-check the imports and the flow:

```ts
import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../../src/anchors/anchors.repository.js';
import { AnchorsService } from '../../src/anchors/anchors.service.js';
import { FakeChainClient } from '../../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../../src/content/document-content-provider.js';

/**
 * Spawned by test/recovery.spec.ts to prove crash recovery with a real process crash.
 *
 * It runs the production anchorDocument() against a file-backed fake chain. The
 * fake kills this process (exit code 9) the instant the chain accepts the
 * transaction — i.e. after the write-ahead intent is committed and after the
 * broadcast, but before the status update (the point where a naive design
 * would persist the anchor). The parent then restarts and recovers.
 */
const [stateFile, documentId, versionRaw, confirmBeforeCrashRaw] = process.argv.slice(2);
if (!stateFile || !documentId || !versionRaw) {
  console.error('usage: child.ts <stateFile> <documentId> <version> [confirmBeforeCrash=0|1]');
  process.exit(2);
}

const version = Number(versionRaw);
const confirmBeforeCrash = confirmBeforeCrashRaw === '1';

const prisma = new PrismaClient();
const chain = new FakeChainClient({ stateFile });
chain.onBroadcast = (txId) => {
  if (confirmBeforeCrash) chain.confirmTx(txId, 4242n);
  // The scripted crash: the chain has the transaction, our status write is lost.
  process.exit(9);
};
const content = new InMemoryDocumentContentProvider();
content.publish(documentId, version, { reportType: 'clinical-summary', anchoredIn: 'crash-recovery-test' });
const repository = new AnchorsRepository(prisma);
const service = new AnchorsService(content, chain, repository);

try {
  await service.anchorDocument(documentId, version);
} catch {
  // The scripted exit(9) normally fires inside the broadcast; reaching here means
  // something else went wrong — the error is reported via the non-zero exit code.
  throw new Error('anchorDocument returned before the scripted crash');
}
await prisma.$disconnect();
```

Hmm — the catch: if exit(9) fired, we never reach here. If the service completed normally (a bug), it falls through to $disconnect and implicit exit 0 → the test fails (expect 9) ✓. Actually if the service completed, the code is 0, the assertion fails with the message. But my catch rethrows → unhandled rejection → exit 1 ✓. Wait, the catch block: if a BroadcastTimeoutError is thrown... it can't be, because exit(9) is synchronous inside onBroadcast before the throw. But note: onBroadcast is awaited in the fake; process.exit(9) terminates immediately ✓. So the try/catch is nearly dead code; fine. Actually — a subtle risk: `process.exit(9)` inside an async hook — terminates the process regardless of the call stack ✓.

But wait — one more: the child's `anchorDocument` → createIntent commits → broadcast → the fake records + persists + onBroadcast → exit(9). Between createIntent's commit and the exit, could an uncommitted... no, it's committed ✓.

And the harness's `h.prisma` is used by the parent for the restarted repository — the harness has its own PrismaClient (connected) ✓.

**Now the `harness.ts`** — the full text:

```ts
import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { AnchorsService } from '../src/anchors/anchors.service.js';
import { ConfirmationWorkerService, RecoverySweepService } from '../src/anchors/anchors.worker.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../src/content/document-content-provider.js';

export interface Harness {
  prisma: PrismaClient;
  chain: FakeChainClient;
  content: InMemoryDocumentContentProvider;
  repo: AnchorsRepository;
  service: AnchorsService;
  confirmation: ConfirmationWorkerService;
  sweep: RecoverySweepService;
}

/**
 * A service-level test harness: the real services, the real Prisma/Postgres, a
 * scripted fake chain, and an in-memory content provider. Every test uses a fresh
 * document id, so tests are isolated without deleting rows.
 *
 * Requires DATABASE_URL to point at a migrated PostgreSQL database
 * (`pnpm db:migrate`) and the generated Prisma client (`pnpm prisma:generate`).
 */
export function createHarness(): Harness {
  const prisma = new PrismaClient();
  const chain = new FakeChainClient();
  const content = new InMemoryDocumentContentProvider();
  const repo = new AnchorsRepository(prisma);
  const service = new AnchorsService(content, chain, repo);
  const confirmation = new ConfirmationWorkerService(repo, chain);
  const sweep = new RecoverySweepService(repo, chain);
  return { prisma, chain, content, repo, service, confirmation, sweep };
}

export async function disposeHarness(harness: Harness): Promise<void> {
  await harness.prisma.$disconnect();
}

/** A fixed sample report: nested objects in non-sorted key order, decimals, booleans, arrays, UTF-8 text. */
export const SAMPLE_CONTENT = {
  reportType: 'clinical-summary',
  subject: 'Patient 000-1234',
  vitals: { heartRate: 72, spo2: 0.98, notes: 'stable, no intervention required' },
  sections: ['admission', 'course', 'discharge'],
  metadata: { author: 'dr. ávila', unit: 'ICU-3', reviewed: true },
};
```

**Re-examine the potential runtime pitfall — the Prisma client in the child process spawned via tsx**: `@prisma/client` needs the generated client (a postinstall/generate step). The test script runs `prisma generate` first ✓. The child imports @prisma/client → the generated code at node_modules/.prisma ✓.

**Another pitfall — `new PrismaClient()` in the harness per test**: many connections; fine.

**Vitest parallelism and the DB** — each spec file is a separate process; concurrent queries are fine.

**Now the `docs/canonicalization.md`** — write it fully (the normative spec). Include an example:

An example content:
```json
{ "b": 1, "a": { "y": true, "x": [1, 2.5] } }
```
Canonical: `{"a":{"x":[1,2.5],"y":true},"b":1}`
The hash is the lowercase hex of sha256 of its UTF-8.

Also state: the top-level value must be an object or array (reports are structured documents)? I allowed any JSON value in the implementation. The doc says "the content is the parsed JSON of the report body; in practice an object." I'll keep the implementation permissive and note the expectation. Consistency: the doc describes the domain as "a JSON value" ✓.

Also mention: canonicalization is applied to the parsed structured content, never to the PDF bytes; whitespace/formatting differences in the source JSON that don't change the parsed value (key order, whitespace, number literal form that parses to the same double) all produce the same hash.

Important nuance — "number literal form that parses to the same double": e.g. `0.10` vs `0.1` → the same double → the same canonical form. ✓ state that.

**The migration SQL — double-check the Prisma-style column list** and the enum:

```sql
-- CreateEnum
CREATE TYPE "anchor_status" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid()),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "anchor_status" NOT NULL DEFAULT 'PREPARED',
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "block_number" BIGINT,
    "block_hash" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_tx_id_key" ON "anchors"("tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");
```

**The schema.prisma**:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AnchorStatus {
  PREPARED
  BROADCAST_SENT
  OUTCOME_UNKNOWN
  CONFIRMED
  FAILED

  @@map("anchor_status")
}

model Anchor {
  id                String       @id @default(uuid())
  documentId        String       @map("document_id")
  version           Int
  contentHash       String       @map("content_hash")
  txId              String       @unique @map("tx_id")
  signedTx          String       @map("signed_tx")
  payload           Json
  status            AnchorStatus @default(PREPARED)
  broadcastAttempts Int          @default(0) @map("broadcast_attempts")
  blockNumber       BigInt?      @map("block_number")
  blockHash         String?      @map("block_hash")
  failureReason     String?      @map("failure_reason")
  createdAt         DateTime     @default(now()) @map("created_at")
  confirmedAt       DateTime?    @map("confirmed_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")

  @@unique([documentId, version], map: "anchor_document_version_key")
  @@map("anchors")
}
```

The migration's unique index name: Prisma names a composite unique index `<table>_<fields>_key` → "anchors_document_id_version_key" ✓ (the `map:` overrides the constraint name — for @@unique with map, the index name = the map value ✓ matches).

**Let me sanity-check the acceptance list once more**:

1. "The intent with the tx identity is committed before broadcast() is called" ✓ write-ahead flow + a test that captures the DB state at the moment of broadcast (PREPARED row with the txId).
2. "Broadcast times out but landed → recovery confirms from the receipt, no re-broadcast" ✓ two tests (in-process + a real crash).
3. "Broadcast times out and did not land → same signed tx re-broadcast, one anchor" ✓.
4. "Crash between broadcast and confirm → restart recovers, one anchor total" ✓ the crash test.
5. "Anchor the same (document, version) twice → rejected by the database" ✓ the unique constraint + a 409 test; the constraint is schema-level (migration).
6. "verify returns a proof for matching content and a mismatch report otherwise" ✓.

Deliverables: Prisma schema with uniqueness ✓, anchorDocument/verify ✓, confirmation worker + recovery sweep ✓, tests ✓, documented canonicalization ✓.

**Now — final check on imports/exports and unused imports per file** (tsc strict noUnusedLocals? I didn't enable noUnusedLocals — I'll keep the flag list minimal; but I'll be tidy anyway).

Let me re-verify a few TS details:

- `import { Inject, Injectable } from '@nestjs/common';` ✓.
- The `Logger` from @nestjs/common ✓.
- In the service: I import `BroadcastRejectedError` from common (the domain) and `BroadcastRejectionError` from chain — used in a catch ✓. `BroadcastTimeoutError` is not imported (any non-rejection error → unknown) ✓ good — I don't need to import it.
- In the worker: I import `BroadcastRejectionError` ✓ used.
- In the controller: I import `AnchorRecord` (type) ✓, `AnchorsService`, `VerifyReport` (type) ✓. `AnchorProof` is unused → don't import.
- `VerifyReportDto`'s txId is optional — I set it conditionally ✓.

- In `anchors.service.ts`, the VerifyReport references `AnchorStatusValue` — import from the repository ✓.

- The repository: I import `Prisma` (for the error class) and the type `Anchor` ✓, `AnchorTxPayload` (type) ✓, `ChainReceipt` (type) ✓, `PrismaService` ✓.

- main.ts: imports HttpStatus (used in the internal default) ✓, INestApplication type ✓, ArgumentsHost ✓, ExceptionFilter ✓, Catch ✓, HttpException ✓, ValidationPipe ✓, Logger ✓, NestFactory ✓, AppModule ✓, DomainError ✓, pathToFileURL ✓.

- The fake chain: `createHash`, fs functions, chain types ✓. `PreparedTx` used ✓. `AnchorTxPayload` used ✓. `ChainReceipt` used ✓.

- The harness: all used ✓.

**A subtle TS point in the fake**: `private state` is initialized in the constructor via a conditional — TS strict property initialization: I declare `private readonly state: FakeChainState;` and assign in the constructor ✓.

`private readonly stateFile: string | undefined;` assigned ✓.

**The `onBroadcast` property** — public, optional ✓ assigned by the test after construction ✓ (not readonly).

**`scriptBroadcast` rejectionReason** — stored; used on 'reject' ✓.

Now — **the API spec's `post` helper returns `body: any`** — I'll type it:

```ts
interface ApiResponse { status: number; body: any; }
```
`any` explicit — fine under strict (no noExplicitAny lint). OK.

**The crash test — the `runCrashChild` closure uses `spawn`** — import from node:child_process ✓.

**Vitest + `process.env` mutation at module scope** — the recovery spec sets RECOVERY_MIN_AGE_MS — but the recovery spec's harness's sweep reads env per sweepOnce ✓.

**One risk**: the `expect(code, message).toBe(9)` in the crash test — vitest's expect signature is `expect(actual, message?)` ✓ supported.

**The watchdog timeout 60s + testTimeout 90s** ✓.

**Now, does the `--import tsx` work when tsx is a devDependency under pnpm?** `node --import tsx` — Node resolves 'tsx' via the ESM loader from the cwd's node_modules ✓ (pnpm hoists to the project node_modules ✓).

**Also the child's `new PrismaClient()`** — Prisma 6: `import { PrismaClient } from '@prisma/client'` ✓.

**The Prisma 6 `@prisma/client` + `prisma-client-js` generator** — supported (the default) ✓.

Let me also reconsider the **`@@map` on the enum + the migration type name** — Prisma with `@@map("anchor_status")` generates `CREATE TYPE "anchor_status"` ✓.

**The BigInt default**: confirmTx default `1_000n` ✓.

**The verify 'pending' union's anchorStatus** — the repository's status for a pending row is one of the three ✓.

Now — **the `details` for the `AlreadyAnchoredError`** — the controller's 409 test asserts `details.existingStatus === 'BROADCAST_SENT'` ✓ the error carries it ✓ the filter passes details through ✓.

**The validation envelope details** — `details.message` is an array ✓.

I think I'm ready to write it all out. Also — **README**? Not called for. Skip.

Wait — one more: the task says "begin with the first heading" — the format is: for each file, a level-3 heading with the path, then a fenced block. No prose. I'll output the files in a sensible order.

Also, "do not restate files you aren't modifying" — there's no existing codebase; everything is new ✓.

Let me also reconsider whether `test/harness.ts` violates "test/<feature>.spec.ts" — that's the spec naming; a helper file is fine.

Another potential issue: **the `vitest` config `include`** — the default also picks up test/**/*.spec.ts; I'll set it explicitly ✓.

**`prisma generate` in the `test` script** — regenerates before each run; needs the prisma CLI ✓ devDep.

Let me also double-check the **`JSON.stringify(tx, Object.keys(tx).sort())`** — the replacer array must include all keys ✓; the values are string|number ✓ deterministic ✓.

And **the `txId` uniqueness across documents**: the payload includes documentId+version+hash → different per (doc,version) ✓; two different contents for the same version → different hash → different txId ✓ (though the second insert is blocked by the composite constraint anyway).

**The `broadcastAttempts` assertion in the did-not-land test**: initial createIntent (0) → timeout → markOutcomeUnknown (1) → sweep re-broadcast ok → markBroadcastSent (2) ✓ I assert 2 ✓.

In the timeout-landed test: 0 → markOutcomeUnknown → 1; the sweep confirms (no attempt change) → I don't assert attempts there, fine.

**The `updatedAt` staleness in findStuck**: markOutcomeUnknown updates → updatedAt now; minAge 0 in the test → lt cutoff(now) — is the cutoff exactly now? `new Date(Date.now() - 0)` → the row's updatedAt is slightly earlier (ms precision) → lt holds if updatedAt < cutoff. Race: if the row's updatedAt equals the cutoff millisecond... `lt` is strict → could skip in the same-millisecond case! In the test, the row is created before the sweep runs (several ms apart; DB timestamps are millisecond precision). The risk is minimal but real (same ms). To be safe: minAge 0 → the cutoff = now; the row's updatedAt is written at least 1 DB round-trip earlier — but the same ms is possible? The anchorDocument call includes multiple awaited round-trips (commit, broadcast, update) → at least a few ms. Acceptable. Alternatively, I could use `lte`? Prisma's `lt`/`lte` — I'll use `lte`? With minAge>0, lte vs lt is irrelevant; with 0, lte is safer. Hmm — but semantically "older than" — I'll use `lt` and accept it; the test has multiple round-trips. Actually, let me make findStuck robust: cutoff = now - olderThanMs; where updatedAt < cutoff. In the test flow, between the row's last update and the sweep's query there are at least: the expect() calls + the sweep construction + the findStuck query — microseconds? expect() is synchronous and fast... the anchorDocument's last DB write (markOutcomeUnknown) is committed before `record` returns; then the test does `expect`, `confirmTx` (in-memory), then `sweepOnce` → findStuck. The time between is sub-millisecond to a few ms. The DB stores TIMESTAMP(3). The row's updatedAt is, say, T; the cutoff is computed at T+ε. If ε < 1ms and they're in the same ms → T < T is false → the row is skipped → the test fails!

That's a real flake risk. Mitigation: in the test, insert a small delay before the sweep (`await new Promise(r => setTimeout(r, 5))`)? Ugly. Better: findStuck with `olderThanMs = 0` → I'll interpret 0 as "no age filter": if olderThanMs <= 0, omit the updatedAt condition. That's clean:

```ts
const where: Prisma.AnchorWhereInput = { status: { in: ['PREPARED', 'OUTCOME_UNKNOWN'] } };
if (olderThanMs > 0) where.updatedAt = { lt: new Date(Date.now() - olderThanMs) };
```
✓ no flake. (In production the default 5000 prevents churn on in-flight rows anyway.)

**Similarly the worker's findBroadcastSent** — no age filter ✓.

Now — **the sweep in the app (production) with minAge 5000 and the worker running**: an anchorDocument timeout sets OUTCOME_UNKNOWN at T; the sweep at T+5s asks the chain ✓.

**The `Prisma.AnchorWhereInput` type import** — `import { Prisma } from '@prisma/client'` ✓.

Let me also handle **the `findStuck` param order** (olderThanMs, limit) ✓.

**The `markConfirmed` with the receipt including a failureReason for a confirmed receipt** — the receipt has no failureReason ✓.

**The controller's `toVerifyReportDto` base typing**: `anchorStatus: report.anchorStatus` — the type is a union of all anchorStatus values ✓ matches `VerifyReport['anchorStatus']` ✓.

`expectedHash: report.expectedHash` — string | null ✓.

OK. One more thought — **should `verify` be a GET?** The spec signature `verify(documentId, version, content)` — content in the body → POST ✓.

**The `@HttpCode(202)`** — with a body ✓.

Let me also re-verify the **the API spec's `app.get(ConfirmationWorkerService)`** — ConfirmationWorkerService is provided in AnchorsModule → accessible from the app ✓.

**The reflect-metadata import in the API spec** — it's the first line ✓ (before other imports? ESM import hoisting: all imports are evaluated in order before the module body; the order among them is source order → 'reflect-metadata' first ✓).

Actually — does @nestjs/testing import @nestjs/core, which imports @nestjs/common, which (in v10/11) imports reflect-metadata internally? I'm not 100% sure, but my explicit import covers it.

**The tsconfig `types: ["node"]`** — excludes vitest's types from the tsc build (tests are excluded anyway) ✓.

**The `import type { AddressInfo } from 'node:net'`** in the API spec ✓ used in a cast.

I'm fairly confident in the solution. Let me also add a **short header comment** in each file stating the role — helpful and conventional.

One last check — **the format**: "for each file, a level-3 heading holding only the repository-relative path, immediately followed by a single fenced block holding only the file's content." No prose between. I'll output ~25 files.

File order:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20250101000000_init/migration.sql
7. docs/canonicalization.md
8. src/main.ts
9. src/app.module.ts
10. src/common/domain-error.ts
11. src/prisma/prisma.module.ts
12. src/prisma/prisma.service.ts
13. src/chain/chain-client.ts
14. src/chain/fake-chain-client.ts
15. src/chain/chain.module.ts
16. src/content/document-content-provider.ts
17. src/content/content.module.ts
18. src/anchors/anchors.repository.ts
19. src/anchors/anchors.service.ts
20. src/anchors/anchors.worker.ts
21. src/anchors/anchors.controller.ts
22. src/anchors/anchors.module.ts
23. test/harness.ts
24. test/canonical-hash.spec.ts
25. test/anchor.spec.ts
26. test/verify.spec.ts
27. test/recovery.spec.ts
28. test/api.spec.ts
29. test/crash/child.ts

Let me carefully write the final content of each, keeping imports consistent with .js extensions.

Double-check the `anchors.service.ts` imports:
- node:crypto createHash ✓
- @nestjs/common: Inject, Injectable, Logger ✓
- ../chain/chain-client.js: CHAIN_CLIENT, ChainClient, AnchorTxPayload (type), BroadcastRejectionError ✓
- ../content/document-content-provider.js: DOCUMENT_CONTENT, DocumentContentProvider ✓
- ../common/domain-error.js: AlreadyAnchoredError, InvalidContentError, BroadcastRejectedError ✓
- ./anchors.repository.js: AnchorsRepository, AnchorRecord, AnchorStatusValue, DuplicateAnchorError ✓

`anchors.worker.ts` imports: @nestjs/common (Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit) ✓; chain-client.js (CHAIN_CLIENT, ChainClient, BroadcastRejectionError) ✓; anchors.repository.js (AnchorsRepository) ✓.

`anchors.controller.ts`: @nestjs/common (Body, Controller, HttpCode, HttpStatus, Inject, Post) ✓; class-validator ✓; anchors.repository.js (AnchorRecord type) ✓; anchors.service.js (AnchorsService, VerifyReport type) ✓.

The repository: @nestjs/common (Inject, Injectable); @prisma/client (Prisma, and the type Anchor); chain-client.js (AnchorTxPayload, ChainReceipt types); prisma.service.js (PrismaService) ✓.

The `import { Prisma } from '@prisma/client'` — the value import for the error class ✓; `import type { Anchor } from '@prisma/client'` separately. Combined: `import { Prisma, type Anchor } from '@prisma/client';` — TS 5 inline type ✓.

main.ts — verify `codeForStatus` default 'http_error' ✓.

In the API spec — `import { ConfirmationWorkerService } from '../src/anchors/anchors.worker.js';` ✓.

The recovery spec imports: spawn from node:child_process; rmSync from node:fs; tmpdir from node:os; join from node:path; fileURLToPath from node:url; randomUUID from node:crypto; vitest; AnchorsRepository; ConfirmationWorkerService, RecoverySweepService; canonicalHashOf; FakeChainClient; the harness (createHarness, disposeHarness, Harness type) ✓.

The anchor spec imports: randomUUID; vitest hooks; the domain errors (AlreadyAnchoredError? — I use toMatchObject on code instead of a class — I need to import DocumentVersionNotFoundError and InvalidContentError for toThrow(class) ✓; AlreadyAnchoredError is not needed if I use toMatchObject — but `rejects.toThrow(DocumentVersionNotFoundError)` needs the class ✓. Also import the AnchorRecord type for the hook variable ✓.

The verify spec imports: randomUUID; vitest; canonicalHashOf; the harness ✓.

`canonical-hash.spec.ts` imports: vitest; canonicalizeJson, canonicalHashOf, CanonicalizationError from the service; SAMPLE_CONTENT from the harness ✓.

Now — one thing: the harness's `SAMPLE_CONTENT` is typed as a plain object; the spread `{ ...SAMPLE_CONTENT, sections: [...] }` is fine.

The tampered `vitals` in the verify spec: `{ ...SAMPLE_CONTENT, vitals: { ...SAMPLE_CONTENT.vitals, heartRate: 99 } }` — TS: the vitals type is inferred; the spread is fine.

The canonical-hash spec's ascii variant: `{ ...SAMPLE_CONTENT, metadata: { ...SAMPLE_CONTENT.metadata, author: 'dr. avila' } }` ✓.

Now — **a potential issue with `expect(report.proof).toEqual({ txId, blockNumber: 4321n, blockHash: expect.stringMatching(...) })`** — toEqual with asymmetric matchers ✓ supported.

**The BigInt in toEqual** ✓.

I'll also make sure the **service's verify 'verified' branch** uses `record.blockNumber ?? 0n` — with strict TS, `record.blockNumber` is `bigint | null` ✓.

**The `AnchorDto.status` type** — `AnchorRecord['status']` ✓.

**The controller's `toVerifyReportDto`**:

```ts
function toVerifyReportDto(report: VerifyReport): VerifyReportDto {
  const base: VerifyReportDto = {
    result: report.result,
    documentId: report.documentId,
    version: report.version,
    expectedHash: report.expectedHash,
    actualHash: report.actualHash,
    anchorStatus: report.anchorStatus,
    proof: null,
    failureReason: report.failureReason,
  };
  if (report.result === 'verified') {
    base.proof = { txId: report.proof.txId, blockNumber: report.proof.blockNumber.toString(), blockHash: report.proof.blockHash };
  } else if ('txId' in report) {
    base.txId = report.txId;
  }
  return base;
}
```
TS: `report.proof` after narrowing on result === 'verified' → AnchorProof ✓. `'txId' in report` — report is a union; `in` narrowing works ✓ (pending and anchor_failed have txId).

VerifyReportDto:

```ts
export interface VerifyReportDto {
  result: 'verified' | 'content_mismatch' | 'not_anchored' | 'pending' | 'anchor_failed';
  documentId: string;
  version: number;
  expectedHash: string | null;
  actualHash: string;
  anchorStatus: string | null;
  proof: { txId: string; blockNumber: string; blockHash: string } | null;
  txId?: string;
  failureReason: string | null;
}
```
Simpler anchorStatus: string | null ✓.

Now the **docs/canonicalization.md** final text — I'll write it thoroughly but concisely.

Also — **the `ASSUMPTION` comment** requirement: "if a symbol you need is truly absent from the task... mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point that matters." The content source for anchorDocument is the key unresolved point. I put a multi-line comment in the content provider file; I'll make sure the exact marker `// ASSUMPTION:` appears there:

```ts
// ASSUMPTION: anchorDocument(documentId, version) takes no content argument, so the
// structured content must come from somewhere; the task does not specify the report
// store, so it is injected as this port. The in-memory stand-in below wires this
// self-contained build; the platform's report store implements the same contract.
```
✓ a single ASSUMPTION comment at the point that matters.

Are there other assumptions? The chain client's default implementation (fake in production) — it's stated in the task ("fakes for tests" / "no real RPC"), so it's not an assumption; I'll comment without the marker. The HTTP surface design — a derived choice, fine.

I think I'm ready. Let me also sanity-check that **no file exceeds reasonableness** and that all braces match. I'll write carefully.

One more: **the `package.json` name** "report-anchoring" matches the issue's repo name ✓.

And **engines node >=20** ✓.

Also, `pnpm` — I'll add a `packageManager` field? "pnpm as the package manager" — I'll add `"packageManager": "pnpm@9.15.0"`. A nice touch, consistent with the convention.

Let me finalize the fake chain's `confirmTx` default blockNumber — I'll use `1_000n`.

In the recovery spec's "stale PREPARED" test, I build the payload twice (prepare + createIntent) — I'll construct a `payload` const:

```ts
const payload = { kind: 'report_anchor', documentId, version: 1, contentHash } as const;
const prepared = await h.chain.prepare(payload);
await h.repo.createIntent({ documentId, version: 1, contentHash, txId: prepared.txId, signedTx: prepared.signedTx, payload });
```
`as const` — the payload type must match AnchorTxPayload: kind is 'report_anchor' ✓ (as const preserves the literal) ✓.

Also `h.content.publish` in beforeEach with `{ reportType: 'clinical-summary' }` — that's used in the timeout-landed/did-not-land tests (the service anchors that content) ✓.

**The crash child's content** — `{ reportType: 'clinical-summary', anchoredIn: 'crash-recovery-test' }` ✓.

Now, the **`runCrashChild`** returns a promise; I'll type it.

Edge — **vitest worker cwd**: vitest runs with cwd = project root ✓ so `--import tsx` resolves and DATABASE_URL is inherited from the env (the test runner's env) ✓.

**Final review of the main.ts isEntryPoint logic** — when run via `tsx src/main.ts`, process.argv[1] = the absolute path to src/main.ts ✓ pathToFileURL matches import.meta.url ✓. When run via `node dist/main.js` ✓. When imported by vitest — argv[1] is the vitest CLI path → mismatch → no boot ✓.

Also — **the `configureApi` export is used by the API spec** ✓.

Alright — let me also verify that **the `ValidationPipe` + `forbidNonWhitelisted`** doesn't break the `content` field being `any` (e.g. an object) — the pipe validates declared constraints only; `@IsDefined()` passes for any defined value including objects ✓; transform: true tries `classToPlain`/plainToClass — for a nested object without decorators, it stays as-is (the transformer creates a class instance only for typed properties with a type; unknown → plain) ✓.

Hmm — one subtle: with `transform: true`, the body is transformed into a DTO instance; the unknown-typed `content` property — class-transformer leaves plain objects as plain ✓.

**The 400 for a missing `content`**: `@IsDefined()` — the property is missing → undefined → fails ✓ 400 with the details.message array including 'content must be defined' ✓.

Alright, let me write out the final answer. I'll number the files in the order above. I'll keep the code comments English, professional.

Actually — wait, let me re-verify one more time the **`AnchorsService` catch block for the `markFailed` on rejection**: after markFailed, it throws BroadcastRejectedError — the row is FAILED, the HTTP is 502 ✓.

And **`markOutcomeUnknown` returns the record** — the service returns it (202) ✓.

**The logger.warn in the service** ✓.

Also, the service's `anchorDocument` — if `chain.prepare` throws (shouldn't in the fake) — propagates as a 500 internal_error. Fine.

**Check the `DuplicateAnchorError` handling when the existing lookup returns null** (shouldn't happen) — rethrow the original Prisma error → 500. Acceptable.

Now — **the `countByDocumentVersion`** is used in tests ✓.

Let me also verify that the **Prisma `findMany where status in`** typing with the string literals against the enum — the generated input accepts the enum union; the string literals match ✓.

**The `orderBy: { updatedAt: 'asc' }`** ✓.

Time to write it all out. I'll keep each file complete.

One more consideration on the **`docs/canonicalization.md`** — include the full algorithm + an example + notes on determinism + what is explicitly not part of the hash (the PDF, the document metadata wrapper). Also a note: the hash is computed over the parsed JSON, so two JSON texts that parse to the same value hash identically (modulo number literal parsing to the same double).

And state the encoding of the hash: lowercase hex, 64 chars, no prefix.

Let me write the doc:

```md
# Canonicalization and content hashing

The structured JSON of a report version is the source of truth. The PDF is a rendering
of that JSON and plays no role in anchoring: the on-chain anchor commits a hash of the
structured content only.

This document is the normative definition of the canonical form. An auditor must be
able to re-derive the exact canonical bytes — and therefore the exact hash — from this
description alone, years later, with no access to this codebase.

## Input domain

The content is a single parsed JSON value: object, array, string, number, boolean, or
`null`. (Report bodies are objects in practice; the rules below define any JSON value.)

Canonicalization is **not defined** for, and rejects:

- `undefined`, symbols, and functions (not JSON values);
- non-finite numbers: `NaN`, `+Infinity`, `-Infinity` (not representable in JSON).

Because the canonical form is a function of the *parsed* value, two JSON texts that
parse to the same value canonicalize identically: key order in the source text,
surrounding whitespace, and number literal spellings that parse to the same
IEEE-754 binary64 (e.g. `0.10` and `0.1`) all produce the same hash.

## Canonical JSON serialization

The canonical form is a single-line JSON string with:

1. **No whitespace** — no spaces, tabs, or newlines anywhere.
2. **Object keys sorted in ascending UTF-16 code-unit order** — the lexicographic
   order of 16-bit code units, locale-independent (i.e. `Array.prototype.sort()`
   default comparison on the key strings). Uppercase sorts before lowercase
   (`"A" < "a"`). Duplicate keys are not expressible in a parsed JSON object.
3. **Array element order preserved** — positions are significant; arrays are never
   sorted.
4. **Strings** escaped exactly as JSON requires, and only as JSON requires:
   `"` → `\"`, `\` → `\\`, and control characters U+0000–U+001F (using the short
   forms `\b \f \n \r \t` where they exist, `\uXXXX` for the rest).
   Characters U+007F and above are **not** escaped; they appear in the output as-is.
5. **Numbers** serialized with ECMAScript `Number::toString` — the shortest string
   that round-trips exactly to the same binary64 value:
   `0.1` → `0.1`, `100` → `100`, `1e21` → `1e+21`, `1.5e-7` → `1.5e-7`.
   Negative zero is serialized as `0` (`-0` and `0` are numerically equal).
6. **Literals** as `true`, `false`, `null`.

### Example

```json
{ "b": 1, "a": { "y": true, "x": [1, 2.5] }, "empty": [] }
```

canonicalizes to

```
{"a":{"x":[1,2.5],"y":true},"b":1,"empty":[]}
```

## Encoding

The canonical bytes are the **UTF-8 encoding** of the canonical JSON string.
(All escapes are ASCII; the only non-ASCII bytes in the output come from
unescaped characters U+007F and above.)

## Hash

```
content_hash = lowercase_hex( SHA-256( canonical_bytes ) )
```

64 lowercase hexadecimal characters, no prefix, no encoding beyond hex.

## On-chain payload

The anchored transaction carries

```json
{ "kind": "report_anchor", "documentId": "<id>", "version": <int>, "contentHash": "<64-hex>" }
```

`prepare()` is local and deterministic, so a given payload always yields the same
`txId` — but the recovery path does not rely on that: it re-broadcasts the *stored*
signed transaction, never a freshly prepared one, so a re-send cannot become a second
anchor.

## Verification

`verify(documentId, version, content)` recomputes `content_hash` from the supplied
content using exactly the steps above and compares it with the stored hash. A match
on a confirmed anchor yields the anchoring proof (txId, block number, block hash);
any other outcome is reported explicitly (`content_mismatch`, `pending`,
`not_anchored`, `anchor_failed`).
```

Good.

Now, the final answer. I'll generate all 29 files.

Wait, let me double-check the `test/recovery.spec.ts` — I reference `beforeAll`/`afterAll`? I only use beforeEach/afterEach + a top-level const for the childScript + the helper function inside the describe. I'll import only what I use: afterEach, beforeEach, describe, expect, it. ✓

And in the recovery spec, the `harness` is per test; the crash test reuses `h.prisma` for the restarted repository — fine (the harness's prisma is connected).

Also — the crash test asserts `chain.broadcastLog[0]!.signedTx` — I'll use non-null assertions; vitest's transpile handles it ✓.

In the API spec — after `app.init()`, I listen via the httpServer — but `app.init()` doesn't listen ✓. And `app.close()` closes the server ✓.

`server.listen(0, '127.0.0.1', cb)` — the signature listen(port, host, callback) ✓.

`(server.address() as AddressInfo).port` ✓.

Alright — also confirming that **the API spec doesn't import `randomUUID` unused** — I use it everywhere ✓.

**Final: the `package.json` scripts order** — `"test": "prisma generate && vitest run"` ✓.

Let me write it all out now, carefully and completely.

Actually, one more thought on the **`AnchorsRepository.findStuck` using `Prisma.AnchorWhereInput`**:

```ts
async findStuck(olderThanMs: number, limit: number): Promise<AnchorRecord[]> {
  const where: Prisma.AnchorWhereInput = {
    status: { in: ['PREPARED', 'OUTCOME_UNKNOWN'] },
  };
  if (olderThanMs > 0) {
    where.updatedAt = { lt: new Date(Date.now() - olderThanMs) };
  }
  const rows = await this.prisma.anchor.findMany({ where, orderBy: { createdAt: 'asc' }, take: limit });
  return rows.map((row) => this.toRecord(row));
}
```
✓.

And `findBroadcastSent(limit: number)` ✓.

Also confirm that the `Anchor` model type import doesn't collide with anything.

**The worker file** — the `AnchorWorkersService` logger log lines ✓.

Done thinking; let me generate the output.
```

## reply

### package.json
```json
{
  "name": "report-anchoring",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Versioned report anchoring on an L2: write-ahead anchor intents, confirmation worker, recovery sweep, and verification.",
  "engines": {
    "node": ">=20"
  },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "prisma:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "test": "prisma generate && vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@prisma/client": "^6.2.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.0.0",
    "@types/node": "^20.17.0",
    "prisma": "^6.2.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Crash-recovery tests spawn a real child process; leave them room.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AnchorStatus {
  // Prepared:        intent committed, not yet broadcast (or crashed before the status write).
  // BroadcastSent:   node accepted the transaction; awaiting a receipt.
  // OutcomeUnknown:  broadcast attempted, outcome unknown (the timeout case).
  //                  Never collapsed into BroadcastSent or Failed.
  // Confirmed:       receipt with a block exists.
  // Failed:          definitive failure (node rejection or failed receipt).
  PREPARED
  BROADCAST_SENT
  OUTCOME_UNKNOWN
  CONFIRMED
  FAILED

  @@map("anchor_status")
}

model Anchor {
  id                String       @id @default(uuid())
  documentId        String       @map("document_id")
  version           Int
  contentHash       String       @map("content_hash")
  txId              String       @unique @map("tx_id")
  signedTx          String       @map("signed_tx")
  payload           Json
  status            AnchorStatus @default(PREPARED)
  broadcastAttempts Int          @default(0) @map("broadcast_attempts")
  blockNumber       BigInt?      @map("block_number")
  blockHash         String?      @map("block_hash")
  failureReason     String?      @map("failure_reason")
  createdAt         DateTime     @default(now()) @map("created_at")
  confirmedAt       DateTime?    @map("confirmed_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")

  // Exactly one anchor per (document, version), enforced at the schema level:
  // a second attempt for the same version is rejected by the database, not by app logic.
  @@unique([documentId, version], map: "anchor_document_version_key")
  @@map("anchors")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "anchor_status" AS ENUM ('PREPARED', 'BROADCAST_SENT', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid()),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "anchor_status" NOT NULL DEFAULT 'PREPARED',
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "block_number" BIGINT,
    "block_hash" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anchors_tx_id_key" ON "anchors"("tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");
```

### docs/canonicalization.md
```md
# Canonicalization and content hashing

The structured JSON of a report version is the source of truth. The PDF is a rendering
of that JSON and plays no role in anchoring: the on-chain anchor commits a hash of the
structured content only.

This document is the normative definition of the canonical form. An auditor must be
able to re-derive the exact canonical bytes — and therefore the exact hash — from this
description alone, years later, with no access to this codebase.

## Input domain

The content is a single parsed JSON value: object, array, string, number, boolean, or
`null`. (Report bodies are objects in practice; the rules below define any JSON value.)

Canonicalization is **not defined** for, and rejects:

- `undefined`, symbols, and functions (not JSON values);
- non-finite numbers: `NaN`, `+Infinity`, `-Infinity` (not representable in JSON).

Because the canonical form is a function of the *parsed* value, two JSON texts that
parse to the same value canonicalize identically: key order in the source text,
surrounding whitespace, and number literal spellings that parse to the same
IEEE-754 binary64 (e.g. `0.10` and `0.1`) all produce the same hash.

## Canonical JSON serialization

The canonical form is a single-line JSON string with:

1. **No whitespace** — no spaces, tabs, or newlines anywhere.
2. **Object keys sorted in ascending UTF-16 code-unit order** — the lexicographic
   order of 16-bit code units, locale-independent (the default `Array.prototype.sort`
   comparison on key strings). Uppercase sorts before lowercase (`"A" < "a"`).
   Duplicate keys are not expressible in a parsed JSON object.
3. **Array element order preserved** — positions are significant; arrays are never
   sorted.
4. **Strings** escaped exactly as JSON requires, and only as JSON requires:
   `"` → `\"`, `\` → `\\`, and control characters U+0000–U+001F (using the short
   forms `\b \f \n \r \t` where they exist, `\uXXXX` for the rest).
   Characters U+007F and above are **not** escaped; they appear in the output as-is.
5. **Numbers** serialized with ECMAScript `Number::toString` — the shortest string
   that round-trips exactly to the same binary64 value:
   `0.1` → `0.1`, `100` → `100`, `1e21` → `1e+21`, `1.5e-7` → `1.5e-7`.
   Negative zero is serialized as `0` (`-0` and `0` are numerically equal).
6. **Literals** as `true`, `false`, `null`.

### Example

```json
{ "b": 1, "a": { "y": true, "x": [1, 2.5] }, "empty": [] }
```

canonicalizes to

```
{"a":{"x":[1,2.5],"y":true},"b":1,"empty":[]}
```

## Encoding

The canonical bytes are the **UTF-8 encoding** of the canonical JSON string.
(All escapes are ASCII; the only non-ASCII bytes in the output come from unescaped
characters U+007F and above.)

## Hash

```
content_hash = lowercase_hex( SHA-256( canonical_bytes ) )
```

64 lowercase hexadecimal characters, no prefix.

## On-chain payload

The anchored transaction carries

```json
{ "kind": "report_anchor", "documentId": "<id>", "version": <int>, "contentHash": "<64-hex>" }
```

`prepare()` is local and deterministic, so a given payload always yields the same
`txId` — but the recovery path does not rely on that: it re-broadcasts the *stored*
signed transaction, never a freshly prepared one, so a re-send cannot become a second
anchor.

## Verification

`verify(documentId, version, content)` recomputes `content_hash` from the supplied
content using exactly the steps above and compares it with the stored hash. A match on
a confirmed anchor yields the anchoring proof (txId, block number, block hash); any
other outcome is reported explicitly (`content_mismatch`, `pending`, `not_anchored`,
`anchor_failed`).
```

### src/main.ts
```ts
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DomainError } from './common/domain-error.js';

/**
 * The single error envelope for the whole API:
 *   { "error": { "code": "<snake_case>", "message": "...", "details": {} } }
 * `code` is the contract; `message` is developer-facing English;
 * `details` is an object, never null.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ExpressLikeResponse>();
    const { status, code, message, details } = this.classify(exception);
    if (status >= 500) {
      this.logger.error(
        `unhandled error: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
      );
    }
    response.status(status).json({ error: { code, message, details } });
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { status, code: codeForStatus(status), message: payload, details: {} };
      }
      const body = payload as Record<string, unknown>;
      const message =
        typeof body.message === 'string'
          ? body.message
          : Array.isArray(body.message)
            ? (body.message as unknown[]).map(String).join('; ')
            : exception.message;
      return { status, code: codeForStatus(status), message, details: body };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: exception instanceof Error ? exception.message : 'Unexpected error',
      details: { name: exception instanceof Error ? exception.name : 'Unknown' },
    };
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'invalid_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'resource_not_found';
    case 409:
      return 'already_anchored';
    default:
      return 'http_error';
  }
}

interface ExpressLikeResponse {
  status(code: number): { json(body: unknown): unknown };
}

/** Wires global validation and the single error envelope. Shared by the server and the tests. */
export function configureApi(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApi(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`report-anchoring API listening on :${port}`, 'Bootstrap');
}

// Runs only when this file is the entry point (tests import configureApi from here).
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void bootstrap();
}
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorsModule } from './anchors/anchors.module.js';

@Module({
  imports: [AnchorsModule],
})
export class AppModule {}
```

### src/common/domain-error.ts
```ts
/**
 * Errors carrying an API contract. Each maps directly onto the single error
 * envelope: a snake_case `code` (the contract), a developer-facing `message`,
 * and `details` (an object, never null).
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AlreadyAnchoredError extends DomainError {
  constructor(
    documentId: string,
    version: number,
    existingTxId: string,
    existingStatus: string,
  ) {
    super(
      'already_anchored',
      409,
      `Document ${documentId} version ${version} is already anchored; exactly one anchor per (document, version) is enforced by the database. Republish the change as a new version instead.`,
      { documentId, version, existingTxId, existingStatus },
    );
  }
}

export class InvalidContentError extends DomainError {
  constructor(reason: string) {
    super(
      'invalid_content',
      400,
      `Report content is not canonicalizable: ${reason}`,
      { reason },
    );
  }
}

export class BroadcastRejectedError extends DomainError {
  constructor(txId: string, reason: string) {
    super(
      'broadcast_rejected',
      502,
      `The chain node definitively rejected the anchor transaction: ${reason}`,
      { txId, reason },
    );
  }
}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/chain/chain-client.ts
```ts
/**
 * The chain client contract.
 *
 * prepare() is local and deterministic: the same payload always yields the same
 * { txId, signedTx }. The transaction identity therefore exists BEFORE any
 * broadcast happens — the anchor intent persists it ahead of broadcast().
 *
 * broadcast() may time out with an unknown outcome: the chain may or may not
 * have the transaction. Timeout (BroadcastTimeoutError) and definitive node
 * rejection (BroadcastRejectionError) are distinct error types for exactly this
 * reason — collapsing them is what the incident was.
 *
 * Confirmation comes only from getReceipt().
 *
 * This build has no real keys and no RPC: the wired default implementation is
 * the deterministic fake in fake-chain-client.ts; a production L2 client
 * implements this same interface.
 */

export const CHAIN_CLIENT = 'CHAIN_CLIENT';

/** What the anchored transaction commits on chain. */
export interface AnchorTxPayload {
  kind: 'report_anchor';
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

/** A receipt exists only once the transaction is included in a block. */
export interface ChainReceipt {
  txId: string;
  outcome: 'confirmed' | 'failed';
  blockNumber: bigint;
  blockHash: string;
  failureReason?: string;
}

export interface ChainClient {
  /** Local and deterministic; never touches the network. */
  prepare(tx: AnchorTxPayload): Promise<PreparedTx>;
  /** May time out (BroadcastTimeoutError) or be definitively rejected (BroadcastRejectionError). */
  broadcast(signedTx: string): Promise<void>;
  /** The only source of truth for what happened to a transaction: a receipt, or nothing. */
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

/** The broadcast call timed out: the chain may or may not have the transaction. Never "sent", never "failed". */
export class BroadcastTimeoutError extends Error {
  constructor(message = 'broadcast timed out; chain outcome unknown') {
    super(message);
    this.name = 'BroadcastTimeoutError';
  }
}

/** The node definitively rejected the transaction (e.g. invalid signature): it is not on the chain. */
export class BroadcastRejectionError extends Error {
  constructor(readonly reason: string) {
    super(`broadcast rejected by node: ${reason}`);
    this.name = 'BroadcastRejectionError';
  }
}
```

### src/chain/fake-chain-client.ts
```ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  AnchorTxPayload,
  BroadcastRejectionError,
  BroadcastTimeoutError,
  ChainClient,
  ChainReceipt,
  PreparedTx,
} from './chain-client.js';

interface BroadcastLogEntry {
  txId: string;
  signedTx: string;
  at: string;
}

interface StoredReceipt {
  outcome: 'confirmed' | 'failed';
  blockNumber: string;
  blockHash: string;
  failureReason?: string;
}

interface FakeChainState {
  broadcasts: BroadcastLogEntry[];
  receipts: Record<string, StoredReceipt>;
}

export type ScriptedBroadcastOutcome = 'ok' | 'timeout' | 'timeout-not-landed' | 'reject';

/**
 * Deterministic fake of the chain client.
 *
 * State (broadcast log + receipts) lives in memory by default. Pass `stateFile`
 * to persist it to disk so it survives a process restart — modelling the fact
 * that a real chain's state is external to any single process. The
 * crash-recovery test relies on this: a child process "dies" after the fake
 * chain has accepted the transaction, and the restarted process sees the same
 * chain state.
 */
export class FakeChainClient implements ChainClient {
  private readonly state: FakeChainState;
  private readonly stateFile: string | undefined;
  private scripted: ScriptedBroadcastOutcome[] = [];
  private rejectionReason = 'simulated node rejection';

  /**
   * Invoked after the fake chain has accepted a broadcast (i.e. the chain now
   * has the transaction) and before the outcome is delivered to the caller.
   * Tests use this to kill the process mid-flight.
   */
  onBroadcast?: (txId: string) => void | Promise<void>;

  constructor(options: { stateFile?: string } = {}) {
    this.stateFile = options.stateFile;
    this.state =
      options.stateFile !== undefined && existsSync(options.stateFile)
        ? (JSON.parse(readFileSync(options.stateFile, 'utf8')) as FakeChainState)
        : { broadcasts: [], receipts: {} };
  }

  /** Queue the outcome of the next broadcast(s). Default (no script) is 'ok'. */
  scriptBroadcast(outcome: ScriptedBroadcastOutcome, rejectionReason?: string): void {
    this.scripted.push(outcome);
    if (rejectionReason !== undefined) this.rejectionReason = rejectionReason;
  }

  get broadcastLog(): readonly BroadcastLogEntry[] {
    return this.state.broadcasts;
  }

  broadcastCountFor(txId: string): number {
    return this.state.broadcasts.filter((entry) => entry.txId === txId).length;
  }

  /** Simulate chain inclusion with a success outcome. */
  confirmTx(txId: string, blockNumber: bigint = 1_000n): void {
    this.state.receipts[txId] = {
      outcome: 'confirmed',
      blockNumber: blockNumber.toString(),
      blockHash: `0x${sha256Hex(`${txId}:block:${blockNumber}`)}`,
    };
    this.persist();
  }

  /** Simulate chain inclusion with a failure outcome (in a block, but failed). */
  failTx(txId: string, failureReason = 'transaction reverted', blockNumber: bigint = 1_000n): void {
    this.state.receipts[txId] = {
      outcome: 'failed',
      blockNumber: blockNumber.toString(),
      blockHash: `0x${sha256Hex(`${txId}:block:${blockNumber}`)}`,
      failureReason,
    };
    this.persist();
  }

  async prepare(tx: AnchorTxPayload): Promise<PreparedTx> {
    // Local and deterministic: the same payload always produces the same identity.
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const txId = `0x${sha256Hex(canonical)}`;
    return { txId, signedTx: `fake-signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const outcome = this.scripted.shift() ?? 'ok';
    const txId = this.txIdFromSignedTx(signedTx);

    if (outcome === 'timeout-not-landed') {
      // The request was lost in flight: the chain has no record of it at all.
      throw new BroadcastTimeoutError();
    }

    // The chain accepted the transaction. Acceptance happens regardless of
    // whether the response to us arrives (that is the 'timeout' case).
    this.state.broadcasts.push({ txId, signedTx, at: new Date().toISOString() });
    this.persist();
    if (this.onBroadcast) await this.onBroadcast(txId);

    if (outcome === 'timeout') throw new BroadcastTimeoutError();
    if (outcome === 'reject') throw new BroadcastRejectionError(this.rejectionReason);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    const stored = this.state.receipts[txId];
    if (!stored) return null;
    return {
      txId,
      outcome: stored.outcome,
      blockNumber: BigInt(stored.blockNumber),
      blockHash: stored.blockHash,
      ...(stored.failureReason !== undefined ? { failureReason: stored.failureReason } : {}),
    };
  }

  private txIdFromSignedTx(signedTx: string): string {
    const prefix = 'fake-signed:';
    return signedTx.startsWith(prefix) ? signedTx.slice(prefix.length) : '0xunknown';
  }

  private persist(): void {
    if (this.stateFile) writeFileSync(this.stateFile, JSON.stringify(this.state));
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
```

### src/chain/chain.module.ts
```ts
import { Module } from '@nestjs/common';
import { CHAIN_CLIENT } from './chain-client.js';
import { FakeChainClient } from './fake-chain-client.js';

@Module({
  providers: [
    // No real keys or RPC in this build: the deterministic fake is the wired
    // chain client. A production L2 client implements the same ChainClient
    // contract and replaces this factory.
    { provide: CHAIN_CLIENT, useFactory: () => new FakeChainClient() },
  ],
  exports: [CHAIN_CLIENT],
})
export class ChainModule {}
```

### src/content/document-content-provider.ts
```ts
import { DomainError } from '../common/domain-error.js';

// ASSUMPTION: anchorDocument(documentId, version) takes no content argument, so
// the structured content must come from somewhere the task does not specify
// (no report store is part of this build). It is therefore injected as this
// port; the in-memory stand-in below wires this self-contained build, and the
// platform's report store implements the same contract in production.
export const DOCUMENT_CONTENT = 'DOCUMENT_CONTENT';

export interface DocumentContentProvider {
  /**
   * Returns the structured JSON content of a published report version.
   * The structured JSON is the source of truth; the PDF is only a rendering.
   * @throws DocumentVersionNotFoundError when no published content exists for the (document, version).
   */
  getContent(documentId: string, version: number): Promise<unknown>;
}

export class DocumentVersionNotFoundError extends DomainError {
  constructor(documentId: string, version: number) {
    super(
      'resource_not_found',
      404,
      `No published report content for document ${documentId}, version ${version}`,
      { documentId, version },
    );
  }
}

/** Development stand-in for the report store (see the assumption above). */
export class InMemoryDocumentContentProvider implements DocumentContentProvider {
  private readonly content = new Map<string, unknown>();

  publish(documentId: string, version: number, content: unknown): void {
    this.content.set(key(documentId, version), content);
  }

  async getContent(documentId: string, version: number): Promise<unknown> {
    const value = this.content.get(key(documentId, version));
    if (value === undefined) throw new DocumentVersionNotFoundError(documentId, version);
    return value;
  }
}

function key(documentId: string, version: number): string {
  return `${documentId}@${version}`;
}
```

### src/content/content.module.ts
```ts
import { Module } from '@nestjs/common';
import { DOCUMENT_CONTENT, InMemoryDocumentContentProvider } from './document-content-provider.js';

@Module({
  providers: [
    // In-memory stand-in for the report store; a production implementation
    // of DocumentContentProvider replaces this factory.
    { provide: DOCUMENT_CONTENT, useFactory: () => new InMemoryDocumentContentProvider() },
  ],
  exports: [DOCUMENT_CONTENT],
})
export class ContentModule {}
```

### src/anchors/anchors.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Anchor } from '@prisma/client';
import type { AnchorTxPayload, ChainReceipt } from '../chain/chain-client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AnchorStatusValue =
  | 'PREPARED'
  | 'BROADCAST_SENT'
  | 'OUTCOME_UNKNOWN'
  | 'CONFIRMED'
  | 'FAILED';

/** The domain view of an anchor row, as read from or written to the database. */
export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  payload: AnchorTxPayload;
  status: AnchorStatusValue;
  broadcastAttempts: number;
  blockNumber: bigint | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date;
}

export interface CreateAnchorIntent {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  payload: AnchorTxPayload;
}

/** Raised when the unique (document_id, version) constraint rejects an insert. */
export class DuplicateAnchorError extends Error {
  constructor(readonly existing: AnchorRecord) {
    super(
      `An anchor already exists for document ${existing.documentId}, version ${existing.version}`,
    );
    this.name = 'DuplicateAnchorError';
  }
}

@Injectable()
export class AnchorsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Persists the anchor intent with status PREPARED. The unique
   * (document_id, version) constraint makes this the single point where
   * "one anchor per (document, version)" is enforced — by the database.
   */
  async createIntent(input: CreateAnchorIntent): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.anchor.create({ data: input });
      return this.toRecord(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.anchor.findUnique({
          where: { documentId_version: { documentId: input.documentId, version: input.version } },
        });
        if (existing) throw new DuplicateAnchorError(this.toRecord(existing));
      }
      throw error;
    }
  }

  async findByDocumentVersion(documentId: string, version: number): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? this.toRecord(row) : null;
  }

  async countByDocumentVersion(documentId: string, version: number): Promise<number> {
    return this.prisma.anchor.count({ where: { documentId, version } });
  }

  /** Anchors the node accepted (BROADCAST_SENT); the confirmation worker polls them for receipts. */
  async findBroadcastSent(limit: number): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: 'BROADCAST_SENT' },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  /**
   * Anchors stuck in broadcast limbo: PREPARED (crashed before, or during, the
   * first broadcast) or OUTCOME_UNKNOWN (the broadcast timed out).
   */
  async findStuck(olderThanMs: number, limit: number): Promise<AnchorRecord[]> {
    const where: Prisma.AnchorWhereInput = {
      status: { in: ['PREPARED', 'OUTCOME_UNKNOWN'] },
    };
    if (olderThanMs > 0) {
      where.updatedAt = { lt: new Date(Date.now() - olderThanMs) };
    }
    const rows = await this.prisma.anchor.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async markBroadcastSent(id: string): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { status: 'BROADCAST_SENT', broadcastAttempts: { increment: 1 } },
    });
    return this.toRecord(row);
  }

  async markOutcomeUnknown(id: string): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { status: 'OUTCOME_UNKNOWN', broadcastAttempts: { increment: 1 } },
    });
    return this.toRecord(row);
  }

  async markConfirmed(id: string, receipt: ChainReceipt): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        confirmedAt: new Date(),
      },
    });
    return this.toRecord(row);
  }

  async markFailed(id: string, failureReason: string): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { status: 'FAILED', failureReason },
    });
    return this.toRecord(row);
  }

  private toRecord(row: Anchor): AnchorRecord {
    return {
      id: row.id,
      documentId: row.documentId,
      version: row.version,
      contentHash: row.contentHash,
      txId: row.txId,
      signedTx: row.signedTx,
      payload: row.payload as AnchorTxPayload,
      status: row.status,
      broadcastAttempts: row.broadcastAttempts,
      blockNumber: row.blockNumber,
      blockHash: row.blockHash,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

### src/anchors/anchors.service.ts
```ts
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AnchorTxPayload } from '../chain/chain-client.js';
import {
  BroadcastRejectionError,
  CHAIN_CLIENT,
  type ChainClient,
} from '../chain/chain-client.js';
import {
  DOCUMENT_CONTENT,
  type DocumentContentProvider,
} from '../content/document-content-provider.js';
import {
  AlreadyAnchoredError,
  BroadcastRejectedError,
  InvalidContentError,
} from '../common/domain-error.js';
import {
  AnchorRecord,
  AnchorStatusValue,
  AnchorsRepository,
  DuplicateAnchorError,
} from './anchors.repository.js';

/* ------------------------------------------------------------------ */
/* Canonicalization — the normative definition of the content hash.   */
/* Written down for auditors in docs/canonicalization.md; the code    */
/* below is that definition.                                          */
/* ------------------------------------------------------------------ */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(`canonicalization failed: ${message}`);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Serializes a JSON value into its canonical form:
 * - no whitespace;
 * - object keys sorted in ascending UTF-16 code-unit order (locale-independent);
 * - array element order preserved;
 * - strings escaped exactly as JSON requires; non-ASCII written as-is;
 * - numbers in ECMAScript shortest round-trip form (`String(n)`); -0 serializes as `0`;
 * - rejects undefined, symbols, functions, and non-finite numbers.
 */
export function canonicalizeJson(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError(
        `the number ${String(value)} is not finite and has no JSON form`,
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`).join(',')}}`;
  }
  throw new CanonicalizationError(`a value of type ${typeof value} is not a JSON value`);
}

/** content_hash = lowercase hex SHA-256 over the canonical bytes (UTF-8 of the canonical form). */
export function canonicalHashOf(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
}

/* ------------------------------------------------------------------ */

export interface AnchorProof {
  txId: string;
  blockNumber: bigint;
  blockHash: string;
}

export type VerifyReport =
  | {
      result: 'verified';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: 'CONFIRMED';
      proof: AnchorProof;
      failureReason: null;
    }
  | {
      result: 'content_mismatch';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: AnchorStatusValue;
      proof: null;
      failureReason: string | null;
    }
  | {
      result: 'not_anchored';
      documentId: string;
      version: number;
      expectedHash: null;
      actualHash: string;
      anchorStatus: null;
      proof: null;
      failureReason: null;
    }
  | {
      result: 'pending';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: 'PREPARED' | 'BROADCAST_SENT' | 'OUTCOME_UNKNOWN';
      proof: null;
      txId: string;
      failureReason: null;
    }
  | {
      result: 'anchor_failed';
      documentId: string;
      version: number;
      expectedHash: string;
      actualHash: string;
      anchorStatus: 'FAILED';
      proof: null;
      txId: string;
      failureReason: string;
    };

@Injectable()
export class AnchorsService {
  private readonly logger = new Logger(AnchorsService.name);

  constructor(
    @Inject(DOCUMENT_CONTENT) private readonly contentProvider: DocumentContentProvider,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(AnchorsRepository) private readonly anchors: AnchorsRepository,
  ) {}

  /**
   * Anchors the structured content of a published (document, version).
   *
   * Order matters (the write-ahead fix):
   *   1. hash the canonical content
   *   2. prepare() — the tx identity exists here, before any broadcast
   *   3. persist the anchor intent (txId and signed tx included) and commit
   *   4. only then broadcast
   *
   * If the process dies at any point after step 3, the recovery path has the
   * txId and can ask the chain what happened.
   */
  async anchorDocument(documentId: string, version: number): Promise<AnchorRecord> {
    const content = await this.contentProvider.getContent(documentId, version);
    const contentHash = this.hashOrReject(content);

    const payload: AnchorTxPayload = { kind: 'report_anchor', documentId, version, contentHash };
    const prepared = await this.chain.prepare(payload);

    let record: AnchorRecord;
    try {
      record = await this.anchors.createIntent({
        documentId,
        version,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
        payload,
      });
    } catch (error) {
      if (error instanceof DuplicateAnchorError) {
        throw new AlreadyAnchoredError(
          documentId,
          version,
          error.existing.txId,
          error.existing.status,
        );
      }
      throw error;
    }

    try {
      // The node accepted the transaction. Acceptance is not confirmation: the
      // state moves to BROADCAST_SENT and only a receipt (polled by the
      // confirmation worker) can move it to CONFIRMED.
      await this.chain.broadcast(prepared.signedTx);
      return await this.anchors.markBroadcastSent(record.id);
    } catch (error) {
      if (error instanceof BroadcastRejectionError) {
        // Definitive rejection: the transaction is not on the chain. The row is
        // FAILED and the slot stays occupied — re-anchor by republishing a new version.
        await this.anchors.markFailed(record.id, error.reason);
        throw new BroadcastRejectedError(prepared.txId, error.reason);
      }
      // Timeout or any other error: the outcome is unknown. Never collapse it
      // into sent or failed — the recovery sweep asks the chain first.
      this.logger.warn(
        `broadcast outcome unknown for document ${documentId} v${version} (txId=${prepared.txId}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return await this.anchors.markOutcomeUnknown(record.id);
    }
  }

  /**
   * Verifies supplied content against the anchor for (document, version):
   * recomputes the canonical hash and returns either the anchoring proof
   * (txId, block) or a report of exactly why the anchor cannot be asserted.
   */
  async verify(documentId: string, version: number, content: unknown): Promise<VerifyReport> {
    const actualHash = this.hashOrReject(content);
    const record = await this.anchors.findByDocumentVersion(documentId, version);

    if (!record) {
      return {
        result: 'not_anchored',
        documentId,
        version,
        expectedHash: null,
        actualHash,
        anchorStatus: null,
        proof: null,
        failureReason: null,
      };
    }
    if (actualHash !== record.contentHash) {
      return {
        result: 'content_mismatch',
        documentId,
        version,
        expectedHash: record.contentHash,
        actualHash,
        anchorStatus: record.status,
        proof: null,
        failureReason: record.failureReason,
      };
    }
    switch (record.status) {
      case 'CONFIRMED':
        return {
          result: 'verified',
          documentId,
          version,
          expectedHash: record.contentHash,
          actualHash,
          anchorStatus: record.status,
          proof: {
            txId: record.txId,
            blockNumber: record.blockNumber ?? 0n,
            blockHash: record.blockHash ?? '',
          },
          failureReason: null,
        };
      case 'FAILED':
        return {
          result: 'anchor_failed',
          documentId,
          version,
          expectedHash: record.contentHash,
          actualHash,
          anchorStatus: record.status,
          proof: null,
          txId: record.txId,
          failureReason: record.failureReason ?? 'unknown failure',
        };
      default:
        return {
          result: 'pending',
          documentId,
          version,
          expectedHash: record.contentHash,
          actualHash,
          anchorStatus: record.status,
          proof: null,
          txId: record.txId,
          failureReason: null,
        };
    }
  }

  private hashOrReject(content: unknown): string {
    try {
      return canonicalHashOf(content);
    } catch (error) {
      if (error instanceof CanonicalizationError) throw new InvalidContentError(error.message);
      throw error;
    }
  }
}
```

### src/anchors/anchors.worker.ts
```ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BroadcastRejectionError, CHAIN_CLIENT, type ChainClient } from '../chain/chain-client.js';
import { AnchorsRepository } from './anchors.repository.js';

/**
 * Confirmation worker: polls receipts for BROADCAST_SENT anchors and advances
 * their state. Confirmation comes only from a receipt — never from
 * broadcast() returning.
 */
@Injectable()
export class ConfirmationWorkerService {
  constructor(
    @Inject(AnchorsRepository) private readonly anchors: AnchorsRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  /** One poll cycle. Returns the number of anchors advanced. */
  async pollOnce(): Promise<number> {
    const rows = await this.anchors.findBroadcastSent(batchSize());
    let advanced = 0;
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      if (receipt.outcome === 'confirmed') {
        await this.anchors.markConfirmed(row.id, receipt);
      } else {
        await this.anchors.markFailed(row.id, receipt.failureReason ?? 'transaction failed on chain');
      }
      advanced += 1;
    }
    return advanced;
  }
}

/**
 * Recovery sweep for anchors stuck in broadcast limbo (PREPARED or
 * OUTCOME_UNKNOWN).
 *
 * Chain first: always getReceipt(txId) before doing anything else. If the
 * transaction landed, it is confirmed (or failed) from the receipt and never
 * re-broadcast. Only when the chain has no trace is the SAME stored signed
 * transaction re-broadcast — the same one, never a freshly prepared one — so a
 * re-send cannot become a second anchor.
 */
@Injectable()
export class RecoverySweepService {
  constructor(
    @Inject(AnchorsRepository) private readonly anchors: AnchorsRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  /** One sweep cycle. Returns the number of anchors processed. */
  async sweepOnce(): Promise<number> {
    const rows = await this.anchors.findStuck(recoveryMinAgeMs(), batchSize());
    let processed = 0;
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        if (receipt.outcome === 'confirmed') {
          await this.anchors.markConfirmed(row.id, receipt);
        } else {
          await this.anchors.markFailed(row.id, receipt.failureReason ?? 'transaction failed on chain');
        }
        processed += 1;
        continue;
      }
      // No trace on the chain: re-broadcast the same signed transaction.
      try {
        await this.chain.broadcast(row.signedTx);
        await this.anchors.markBroadcastSent(row.id);
      } catch (error) {
        if (error instanceof BroadcastRejectionError) {
          await this.anchors.markFailed(row.id, error.reason);
        } else {
          // Still unknown; the next sweep asks the chain again.
          await this.anchors.markOutcomeUnknown(row.id);
        }
      }
      processed += 1;
    }
    return processed;
  }
}

/**
 * Starts the background loops. Intervals come from environment configuration
 * only; a value of 0 disables a loop (tests drive pollOnce()/sweepOnce()
 * directly).
 */
@Injectable()
export class AnchorWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorWorkersService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(ConfirmationWorkerService)
    private readonly confirmationWorker: ConfirmationWorkerService,
    @Inject(RecoverySweepService) private readonly recoverySweep: RecoverySweepService,
  ) {}

  onModuleInit(): void {
    const confirmationPollMs = Number(process.env.CONFIRMATION_POLL_MS ?? 2000);
    const recoverySweepMs = Number(process.env.RECOVERY_SWEEP_MS ?? 10000);

    if (confirmationPollMs > 0) {
      this.timers.push(
        setInterval(() => {
          void this.runCycle('confirmation worker', () => this.confirmationWorker.pollOnce());
        }, confirmationPollMs),
      );
    }
    if (recoverySweepMs > 0) {
      this.timers.push(
        setInterval(() => {
          void this.runCycle('recovery sweep', () => this.recoverySweep.sweepOnce());
        }, recoverySweepMs),
      );
    }
    this.logger.log(
      `workers started (CONFIRMATION_POLL_MS=${confirmationPollMs || 'off'}, RECOVERY_SWEEP_MS=${recoverySweepMs || 'off'})`,
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private runCycle(name: string, cycle: () => Promise<number>): void {
    cycle()
      .then((count) => {
        if (count > 0) this.logger.log(`${name}: processed ${count} anchor(s)`);
      })
      .catch((error: unknown) => {
        this.logger.error(
          `${name} cycle failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      });
  }
}

function batchSize(): number {
  const value = Number(process.env.WORKER_BATCH_SIZE ?? 50);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50;
}

function recoveryMinAgeMs(): number {
  const value = Number(process.env.RECOVERY_MIN_AGE_MS ?? 5000);
  return Number.isFinite(value) && value >= 0 ? value : 5000;
}
```

### src/anchors/anchors.controller.ts
```ts
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { IsDefined, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import type { AnchorRecord } from './anchors.repository.js';
import { AnchorsService, type VerifyReport } from './anchors.service.js';

export class AnchorCreateDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsInt()
  @Min(1)
  version!: number;
}

export class VerifyAnchorDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsInt()
  @Min(1)
  version!: number;

  // The structured content to recompute the hash from: any JSON value, but present.
  @IsDefined()
  content!: unknown;
}

export interface AnchorDto {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  status: AnchorRecord['status'];
  broadcastAttempts: number;
  blockNumber: string | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface VerifyReportDto {
  result: 'verified' | 'content_mismatch' | 'not_anchored' | 'pending' | 'anchor_failed';
  documentId: string;
  version: number;
  expectedHash: string | null;
  actualHash: string;
  anchorStatus: string | null;
  proof: { txId: string; blockNumber: string; blockHash: string } | null;
  txId?: string;
  failureReason: string | null;
}

@Controller('anchors')
export class AnchorsController {
  constructor(@Inject(AnchorsService) private readonly service: AnchorsService) {}

  /**
   * POST /anchors — anchor the structured content of a published (document, version).
   * 202: the intent (with the tx identity) is committed before the broadcast;
   * confirmation happens asynchronously from the receipt.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async anchorDocument(@Body() body: AnchorCreateDto): Promise<AnchorDto> {
    const record = await this.service.anchorDocument(body.documentId, body.version);
    return toAnchorDto(record);
  }

  /**
   * POST /anchors/verify — recompute the hash from the supplied content and return
   * the anchoring proof (txId, block) or a mismatch report saying what differs.
   */
  @Post('verify')
  async verify(@Body() body: VerifyAnchorDto): Promise<VerifyReportDto> {
    const report = await this.service.verify(body.documentId, body.version, body.content);
    return toVerifyReportDto(report);
  }
}

function toAnchorDto(record: AnchorRecord): AnchorDto {
  return {
    id: record.id,
    documentId: record.documentId,
    version: record.version,
    contentHash: record.contentHash,
    txId: record.txId,
    status: record.status,
    broadcastAttempts: record.broadcastAttempts,
    blockNumber: record.blockNumber === null ? null : record.blockNumber.toString(),
    blockHash: record.blockHash,
    failureReason: record.failureReason,
    createdAt: record.createdAt.toISOString(),
    confirmedAt: record.confirmedAt === null ? null : record.confirmedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toVerifyReportDto(report: VerifyReport): VerifyReportDto {
  const base: VerifyReportDto = {
    result: report.result,
    documentId: report.documentId,
    version: report.version,
    expectedHash: report.expectedHash,
    actualHash: report.actualHash,
    anchorStatus: report.anchorStatus,
    proof: null,
    failureReason: report.failureReason,
  };
  if (report.result === 'verified') {
    base.proof = {
      txId: report.proof.txId,
      blockNumber: report.proof.blockNumber.toString(),
      blockHash: report.proof.blockHash,
    };
  } else if ('txId' in report) {
    base.txId = report.txId;
  }
  return base;
}
```

### src/anchors/anchors.module.ts
```ts
import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module.js';
import { ContentModule } from '../content/content.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchorsController } from './anchors.controller.js';
import { AnchorsRepository } from './anchors.repository.js';
import { AnchorsService } from './anchors.service.js';
import {
  AnchorWorkersService,
  ConfirmationWorkerService,
  RecoverySweepService,
} from './anchors.worker.js';

@Module({
  imports: [PrismaModule, ChainModule, ContentModule],
  controllers: [AnchorsController],
  providers: [
    AnchorsRepository,
    AnchorsService,
    ConfirmationWorkerService,
    RecoverySweepService,
    AnchorWorkersService,
  ],
})
export class AnchorsModule {}
```

### test/harness.ts
```ts
import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { AnchorsService } from '../src/anchors/anchors.service.js';
import {
  ConfirmationWorkerService,
  RecoverySweepService,
} from '../src/anchors/anchors.worker.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../src/content/document-content-provider.js';

export interface Harness {
  prisma: PrismaClient;
  chain: FakeChainClient;
  content: InMemoryDocumentContentProvider;
  repo: AnchorsRepository;
  service: AnchorsService;
  confirmation: ConfirmationWorkerService;
  sweep: RecoverySweepService;
}

/**
 * Service-level test harness: the real services, the real Prisma/Postgres, a
 * scripted fake chain, and an in-memory content provider. Every test uses a
 * fresh document id, so tests are isolated without deleting rows.
 *
 * Requires DATABASE_URL pointing at a migrated PostgreSQL database
 * (`pnpm db:migrate`) and the generated Prisma client (`pnpm prisma:generate`).
 */
export function createHarness(): Harness {
  const prisma = new PrismaClient();
  const chain = new FakeChainClient();
  const content = new InMemoryDocumentContentProvider();
  const repo = new AnchorsRepository(prisma);
  const service = new AnchorsService(content, chain, repo);
  const confirmation = new ConfirmationWorkerService(repo, chain);
  const sweep = new RecoverySweepService(repo, chain);
  return { prisma, chain, content, repo, service, confirmation, sweep };
}

export async function disposeHarness(harness: Harness): Promise<void> {
  await harness.prisma.$disconnect();
}

/**
 * A fixed sample report: nested objects whose keys are not in sorted order,
 * decimals, booleans, arrays, and UTF-8 text — so canonicalization actually
 * has work to do.
 */
export const SAMPLE_CONTENT = {
  reportType: 'clinical-summary',
  subject: 'Patient 000-1234',
  vitals: { heartRate: 72, spo2: 0.98, notes: 'stable, no intervention required' },
  sections: ['admission', 'course', 'discharge'],
  metadata: { author: 'dr. ávila', unit: 'ICU-3', reviewed: true },
};
```

### test/canonical-hash.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import {
  canonicalHashOf,
  canonicalizeJson,
  CanonicalizationError,
} from '../src/anchors/anchors.service.js';
import { SAMPLE_CONTENT } from './harness.js';

describe('canonicalization', () => {
  it('is independent of key order and object construction order', () => {
    const a = { zeta: 1, alpha: { m: [1, 2.5, 'x'], b: null }, mid: true };
    const b = { alpha: { b: null, m: [1, 2.5, 'x'] }, mid: true, zeta: 1 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(canonicalHashOf(a)).toBe(canonicalHashOf(b));
  });

  it('sorts keys in UTF-16 code-unit order, which is locale-independent', () => {
    expect(canonicalizeJson({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
  });

  it('emits no whitespace and escapes strings exactly as JSON requires', () => {
    expect(canonicalizeJson({ s: 'a"b\\c\né', empty: [] })).toBe(
      '{"empty":[],"s":"a\\"b\\\\c\\né"}',
    );
  });

  it('serializes numbers in shortest round-trip form and normalizes -0 to 0', () => {
    expect(canonicalizeJson({ n: 0.1 })).toBe('{"n":0.1}');
    expect(canonicalizeJson({ n: 1e21 })).toBe('{"n":1e+21}');
    expect(canonicalizeJson({ n: -0 })).toBe('{"n":0}');
  });

  it('preserves array order (positions are significant)', () => {
    expect(canonicalHashOf([1, 2, 3])).not.toBe(canonicalHashOf([3, 2, 1]));
  });

  it('rejects non-finite numbers, undefined, symbols, and functions', () => {
    expect(() => canonicalizeJson({ n: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: Number.POSITIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: Number.NEGATIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson(Symbol('x'))).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ f: () => 1 })).toThrow(CanonicalizationError);
  });

  it('produces a stable lowercase 64-char SHA-256 hex digest over the UTF-8 canonical bytes', () => {
    const first = canonicalHashOf(SAMPLE_CONTENT);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHashOf(SAMPLE_CONTENT)).toBe(first);
    // A single byte difference (an accented character) must change the digest.
    const ascii = { ...SAMPLE_CONTENT, metadata: { ...SAMPLE_CONTENT.metadata, author: 'dr. avila' } };
    expect(canonicalHashOf(ascii)).not.toBe(first);
  });
});
```

### test/anchor.spec.ts
```ts
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnchorRecord } from '../src/anchors/anchors.repository.js';
import {
  BroadcastRejectedError,
  InvalidContentError,
} from '../src/common/domain-error.js';
import { DocumentVersionNotFoundError } from '../src/content/document-content-provider.js';
import { createHarness, disposeHarness, SAMPLE_CONTENT, type Harness } from './harness.js';

describe('anchorDocument', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, SAMPLE_CONTENT);
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  it('persists the intent with the tx identity BEFORE the broadcast, then broadcasts exactly once', async () => {
    let rowAtBroadcastTime: AnchorRecord | null = null;
    h.chain.onBroadcast = async (txId) => {
      // The fake chain has just accepted the transaction: at this instant,
      // what does our database already say?
      rowAtBroadcastTime = await h.repo.findByDocumentVersion(documentId, 1);
      expect(txId).toMatch(/^0x[0-9a-f]{64}$/);
    };

    const record = await h.service.anchorDocument(documentId, 1);

    // Write-ahead: the intent was committed before the chain saw the transaction.
    expect(rowAtBroadcastTime).not.toBeNull();
    expect(rowAtBroadcastTime!.status).toBe('PREPARED');
    expect(rowAtBroadcastTime!.txId).toBe(record.txId);
    expect(rowAtBroadcastTime!.signedTx).toBe(record.signedTx);

    // After the node accepts, the state is BROADCAST_SENT — not CONFIRMED;
    // confirmation comes only from a receipt.
    expect(record.status).toBe('BROADCAST_SENT');
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('rejects a second anchor for the same (document, version) — the database constraint, not app logic', async () => {
    const first = await h.service.anchorDocument(documentId, 1);

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'already_anchored',
      httpStatus: 409,
      details: { existingTxId: first.txId, existingStatus: 'BROADCAST_SENT' },
    });

    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(1);
  });

  it('lands in OUTCOME_UNKNOWN when the broadcast times out — distinct from sent and from failed', async () => {
    h.chain.scriptBroadcast('timeout');

    const record = await h.service.anchorDocument(documentId, 1);

    expect(record.status).toBe('OUTCOME_UNKNOWN');
    expect(record.txId).toMatch(/^0x[0-9a-f]{64}$/);
    // The chain did accept the transaction; the timeout is only on the response.
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('marks the anchor FAILED and surfaces broadcast_rejected when the node definitively rejects', async () => {
    h.chain.scriptBroadcast('reject', 'invalid signature');

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toBeInstanceOf(
      BroadcastRejectedError,
    );
    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'broadcast_rejected',
      httpStatus: 502,
    });

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('FAILED');
    expect(row!.failureReason).toBe('invalid signature');
  });

  it('returns resource_not_found when the version has no published content, without creating an anchor', async () => {
    await expect(h.service.anchorDocument(documentId, 42)).rejects.toThrow(
      DocumentVersionNotFoundError,
    );
    expect(await h.repo.countByDocumentVersion(documentId, 42)).toBe(0);
  });

  it('refuses non-canonicalizable content before touching the chain or the database', async () => {
    h.content.publish(documentId, 1, { score: Number.NaN });

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toThrow(InvalidContentError);

    expect(h.chain.broadcastLog).toHaveLength(0);
    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(0);
  });
});
```

### test/verify.spec.ts
```ts
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalHashOf } from '../src/anchors/anchors.service.js';
import { createHarness, disposeHarness, SAMPLE_CONTENT, type Harness } from './harness.js';

describe('verify', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, SAMPLE_CONTENT);
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  async function anchorAndConfirm(blockNumber = 12_345n) {
    const record = await h.service.anchorDocument(documentId, 1);
    h.chain.confirmTx(record.txId, blockNumber);
    await h.confirmation.pollOnce();
    return record;
  }

  it('returns the anchoring proof (txId, block) for matching content', async () => {
    const record = await anchorAndConfirm(4321n);

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    if (report.result !== 'verified') throw new Error(`expected verified, got ${report.result}`);
    expect(report.proof).toEqual({
      txId: record.txId,
      blockNumber: 4321n,
      blockHash: expect.stringMatching(/^0x[0-9a-f]+$/),
    });
    expect(report.expectedHash).toBe(canonicalHashOf(SAMPLE_CONTENT));
    expect(report.actualHash).toBe(report.expectedHash);
  });

  it('reports a content mismatch with both hashes when the supplied content differs', async () => {
    await anchorAndConfirm();
    const tampered = { ...SAMPLE_CONTENT, sections: [...SAMPLE_CONTENT.sections].reverse() };

    const report = await h.service.verify(documentId, 1, tampered);

    if (report.result !== 'content_mismatch') {
      throw new Error(`expected content_mismatch, got ${report.result}`);
    }
    expect(report.expectedHash).toBe(canonicalHashOf(SAMPLE_CONTENT));
    expect(report.actualHash).toBe(canonicalHashOf(tampered));
    expect(report.actualHash).not.toBe(report.expectedHash);
    expect(report.proof).toBeNull();
  });

  it('reports not_anchored when the version has no anchor', async () => {
    const report = await h.service.verify(documentId, 7, SAMPLE_CONTENT);

    if (report.result !== 'not_anchored') throw new Error(`expected not_anchored, got ${report.result}`);
    expect(report.expectedHash).toBeNull();
    expect(report.proof).toBeNull();
  });

  it('reports pending with the tx identity when the anchor is not yet confirmed', async () => {
    const record = await h.service.anchorDocument(documentId, 1);

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    if (report.result !== 'pending') throw new Error(`expected pending, got ${report.result}`);
    expect(report.txId).toBe(record.txId);
    expect(report.proof).toBeNull();
  });

  it('prefers the mismatch report over anchor state when the hash differs', async () => {
    await h.service.anchorDocument(documentId, 1); // pending, never confirmed
    const tampered = { ...SAMPLE_CONTENT, vitals: { ...SAMPLE_CONTENT.vitals, heartRate: 99 } };

    const report = await h.service.verify(documentId, 1, tampered);

    expect(report.result).toBe('content_mismatch');
  });

  it('reports anchor_failed with the reason when the anchor failed on chain', async () => {
    h.chain.scriptBroadcast('reject', 'insufficient funds');
    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'broadcast_rejected',
    });

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    if (report.result !== 'anchor_failed') throw new Error(`expected anchor_failed, got ${report.result}`);
    expect(report.failureReason).toBe('insufficient funds');
    expect(report.proof).toBeNull();
  });
});
```

### test/recovery.spec.ts
```ts
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { canonicalHashOf } from '../src/anchors/anchors.service.js';
import {
  ConfirmationWorkerService,
  RecoverySweepService,
} from '../src/anchors/anchors.worker.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { createHarness, disposeHarness, type Harness } from './harness.js';

// The crash tests sweep rows created milliseconds ago.
process.env.RECOVERY_MIN_AGE_MS = '0';

const childScript = fileURLToPath(new URL('./crash/child.ts', import.meta.url));

describe('recovery sweep and confirmation worker', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, { reportType: 'clinical-summary' });
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  it('confirms from the receipt when the broadcast timed out but landed — no re-broadcast', async () => {
    h.chain.scriptBroadcast('timeout');
    const record = await h.service.anchorDocument(documentId, 1);
    expect(record.status).toBe('OUTCOME_UNKNOWN');

    h.chain.confirmTx(record.txId, 77n);
    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('CONFIRMED');
    expect(row!.blockNumber).toBe(77n);
    expect(row!.confirmedAt).toBeInstanceOf(Date);
    // The receipt settled it: the sweep must not re-broadcast.
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('re-broadcasts the SAME signed tx when the chain has no trace, ending with one anchor and one tx identity', async () => {
    h.chain.scriptBroadcast('timeout-not-landed');
    const record = await h.service.anchorDocument(documentId, 1);
    expect(record.status).toBe('OUTCOME_UNKNOWN');
    expect(h.chain.broadcastLog).toHaveLength(0); // the chain truly has no trace

    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(row!.broadcastAttempts).toBe(2);
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
    expect(h.chain.broadcastLog[0]!.signedTx).toBe(record.signedTx); // the same one, not a new one

    h.chain.confirmTx(record.txId, 88n);
    await h.confirmation.pollOnce();

    expect((await h.repo.findByDocumentVersion(documentId, 1))!.status).toBe('CONFIRMED');
    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(1);
    expect(new Set(h.chain.broadcastLog.map((entry) => entry.txId)).size).toBe(1);
  });

  it('broadcasts a stale PREPARED anchor (crashed before the broadcast call) without a second identity', async () => {
    const content = { reportType: 'clinical-summary' };
    const contentHash = canonicalHashOf(content);
    const payload = { kind: 'report_anchor', documentId, version: 1, contentHash } as const;
    const prepared = await h.chain.prepare(payload);
    await h.repo.createIntent({
      documentId,
      version: 1,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
      payload,
    });

    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(h.chain.broadcastLog[0]!.signedTx).toBe(prepared.signedTx);
    expect(h.chain.broadcastCountFor(prepared.txId)).toBe(1);
  });

  it('marks FAILED when the sweep finds a failed receipt, without re-broadcasting', async () => {
    h.chain.scriptBroadcast('timeout');
    const record = await h.service.anchorDocument(documentId, 1);

    h.chain.failTx(record.txId, 'reverted: anchor slot busy', 99n);
    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('FAILED');
    expect(row!.failureReason).toBe('reverted: anchor slot busy');
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('crash between broadcast and status update: the restarted app recovers from the chain — one anchor, one tx identity', async () => {
    const stateFile = join(tmpdir(), `fake-chain-${randomUUID()}.json`);
    const crashDocId = `doc-${randomUUID()}`;
    try {
      const { code, stderr } = await runCrashChild(stateFile, crashDocId, false);
      expect(code, `child should die with the scripted exit code 9; stderr: ${stderr}`).toBe(9);

      // Restart: fresh services, the same (file-backed) chain.
      const chain = new FakeChainClient({ stateFile });
      const repo = new AnchorsRepository(h.prisma);
      const sweep = new RecoverySweepService(repo, chain);
      const confirmation = new ConfirmationWorkerService(repo, chain);

      // The write-ahead intent survived the crash: the row exists with the tx
      // identity, still PREPARED because the crash ate the status update.
      const rowAtRestart = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowAtRestart, 'the anchor intent must have been committed before the crash').not.toBeNull();
      expect(rowAtRestart!.status).toBe('PREPARED');
      const { txId, signedTx } = rowAtRestart!;

      // The chain accepted the transaction before the crash: one broadcast, no receipt.
      expect(chain.broadcastCountFor(txId)).toBe(1);
      expect(chain.broadcastLog[0]!.signedTx).toBe(signedTx);

      // Recovery asks the chain first: no receipt yet, so it re-broadcasts the same signed tx.
      await sweep.sweepOnce();
      const rowAfterSweep = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowAfterSweep!.status).toBe('BROADCAST_SENT');
      expect(rowAfterSweep!.txId).toBe(txId); // the identity was never re-prepared
      expect(chain.broadcastCountFor(txId)).toBe(2);
      expect(chain.broadcastLog[1]!.signedTx).toBe(signedTx); // the same signed tx, not a new one

      // The transaction lands; the confirmation worker confirms from the receipt.
      chain.confirmTx(txId, 555n);
      await confirmation.pollOnce();
      const rowFinal = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowFinal!.status).toBe('CONFIRMED');
      expect(rowFinal!.blockNumber).toBe(555n);

      // Exactly one anchor and exactly one transaction identity.
      expect(await repo.countByDocumentVersion(crashDocId, 1)).toBe(1);
      expect(new Set(chain.broadcastLog.map((entry) => entry.txId)).size).toBe(1);
    } finally {
      rmSync(stateFile, { force: true });
    }
  });

  it('crash after the chain already confirmed: the sweep confirms from the receipt without re-broadcasting', async () => {
    const stateFile = join(tmpdir(), `fake-chain-${randomUUID()}.json`);
    const crashDocId = `doc-${randomUUID()}`;
    try {
      const { code, stderr } = await runCrashChild(stateFile, crashDocId, true);
      expect(code, `child should die with the scripted exit code 9; stderr: ${stderr}`).toBe(9);

      const chain = new FakeChainClient({ stateFile });
      const repo = new AnchorsRepository(h.prisma);
      const sweep = new RecoverySweepService(repo, chain);

      const row = await repo.findByDocumentVersion(crashDocId, 1);
      expect(row).not.toBeNull();
      expect(row!.status).toBe('PREPARED');

      await sweep.sweepOnce();

      const rowFinal = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowFinal!.status).toBe('CONFIRMED');
      expect(rowFinal!.blockNumber).toBe(4242n);
      expect(chain.broadcastCountFor(row!.txId)).toBe(1); // no re-broadcast: the receipt settled it
      expect(await repo.countByDocumentVersion(crashDocId, 1)).toBe(1);
    } finally {
      rmSync(stateFile, { force: true });
    }
  });
});

function runCrashChild(
  stateFile: string,
  documentId: string,
  confirmBeforeCrash: boolean,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', childScript, stateFile, documentId, '1', confirmBeforeCrash ? '1' : '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (code) => {
      clearTimeout(watchdog);
      resolve({ code: code ?? -1, stderr });
    });
  });
}
```

### test/api.spec.ts
```ts
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ConfirmationWorkerService } from '../src/anchors/anchors.worker.js';
import { CHAIN_CLIENT } from '../src/chain/chain-client.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { DOCUMENT_CONTENT, InMemoryDocumentContentProvider } from '../src/content/document-content-provider.js';
import { configureApi } from '../src/main.js';

// The tests drive the workers directly; keep the background loops off.
process.env.CONFIRMATION_POLL_MS = '0';
process.env.RECOVERY_SWEEP_MS = '0';

const SAMPLE = { reportType: 'clinical-summary', vitals: { heartRate: 72, spo2: 0.98 } };

describe('HTTP API', () => {
  let app: INestApplication;
  let baseUrl: string;
  const chain = new FakeChainClient();
  const content = new InMemoryDocumentContentProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAIN_CLIENT)
      .useValue(chain)
      .overrideProvider(DOCUMENT_CONTENT)
      .useValue(content)
      .compile();
    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  it('POST /anchors returns 202 with the anchor intent and its tx identity', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    const { status, body } = await post('/anchors', { documentId, version: 1 });

    expect(status).toBe(202);
    expect(body.documentId).toBe(documentId);
    expect(body.version).toBe(1);
    expect(body.txId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.status).toBe('BROADCAST_SENT');
    expect(typeof body.contentHash).toBe('string');
  });

  it('POST /anchors on an already-anchored version returns the 409 already_anchored envelope', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    await post('/anchors', { documentId, version: 1 });
    const { status, body } = await post('/anchors', { documentId, version: 1 });

    expect(status).toBe(409);
    expect(body.error.code).toBe('already_anchored');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toBeTypeOf('object');
    expect(body.error.details.existingStatus).toBe('BROADCAST_SENT');
  });

  it('POST /anchors without published content returns the 404 resource_not_found envelope', async () => {
    const { status, body } = await post('/anchors', {
      documentId: `doc-${randomUUID()}`,
      version: 3,
    });

    expect(status).toBe(404);
    expect(body.error.code).toBe('resource_not_found');
    expect(body.error.details).toEqual(expect.objectContaining({ version: 3 }));
  });

  it('POST /anchors with an invalid version returns the 400 invalid_request envelope', async () => {
    const { status, body } = await post('/anchors', {
      documentId: `doc-${randomUUID()}`,
      version: 'not-an-int',
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
    expect(Array.isArray(body.error.details.message)).toBe(true);
  });

  it('POST /anchors/verify returns the proof with a string block number for matching content', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    const anchored = await post('/anchors', { documentId, version: 1 });
    chain.confirmTx(anchored.body.txId, 777n);
    // Drive the confirmation worker directly (background loops are off in tests).
    await app.get(ConfirmationWorkerService).pollOnce();

    const { status, body } = await post('/anchors/verify', {
      documentId,
      version: 1,
      content: SAMPLE,
    });

    expect(status).toBe(200);
    expect(body.result).toBe('verified');
    expect(body.proof.txId).toBe(anchored.body.txId);
    expect(body.proof.blockNumber).toBe('777');
    expect(typeof body.proof.blockHash).toBe('string');
  });

  it('POST /anchors/verify returns a mismatch report naming both hashes for differing content', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);
    await post('/anchors', { documentId, version: 1 });

    const tampered = { ...SAMPLE, vitals: { ...SAMPLE.vitals, heartRate: 99 } };
    const { status, body } = await post('/anchors/verify', {
      documentId,
      version: 1,
      content: tampered,
    });

    expect(status).toBe(200);
    expect(body.result).toBe('content_mismatch');
    expect(body.expectedHash).not.toBe(body.actualHash);
  });

  it('POST /anchors/verify reports not_anchored for a version that was never anchored', async () => {
    const { status, body } = await post('/anchors/verify', {
      documentId: `doc-${randomUUID()}`,
      version: 1,
      content: SAMPLE,
    });

    expect(status).toBe(200);
    expect(body.result).toBe('not_anchored');
    expect(body.expectedHash).toBeNull();
    expect(body.proof).toBeNull();
  });

  it('POST /anchors/verify requires the content field', async () => {
    const { status, body } = await post('/anchors/verify', {
      documentId: `doc-${randomUUID()}`,
      version: 1,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
  });
});
```

### test/crash/child.ts
```ts
import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../../src/anchors/anchors.repository.js';
import { AnchorsService } from '../../src/anchors/anchors.service.js';
import { FakeChainClient } from '../../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../../src/content/document-content-provider.js';

/**
 * Spawned by test/recovery.spec.ts to prove crash recovery with a real process
 * crash.
 *
 * It runs the production anchorDocument() against a file-backed fake chain.
 * The fake kills this process (exit code 9) the instant the chain ACCEPTS the
 * transaction — i.e. after the write-ahead intent is committed and after the
 * broadcast, but before the status update; the point where a naive design
 * would persist the anchor and has nothing. The parent then restarts and
 * recovers, and asserts exactly one anchor and one transaction identity.
 */
const [stateFile, documentId, versionRaw, confirmBeforeCrashRaw] = process.argv.slice(2);
if (!stateFile || !documentId || !versionRaw) {
  console.error('usage: child.ts <stateFile> <documentId> <version> [confirmBeforeCrash=0|1]');
  process.exit(2);
}

const version = Number(versionRaw);
const confirmBeforeCrash = confirmBeforeCrashRaw === '1';

const prisma = new PrismaClient();
const chain = new FakeChainClient({ stateFile });
chain.onBroadcast = (txId) => {
  if (confirmBeforeCrash) chain.confirmTx(txId, 4242n);
  // The scripted crash: the chain has the transaction; our status write is lost.
  process.exit(9);
};

const content = new InMemoryDocumentContentProvider();
content.publish(documentId, version, {
  reportType: 'clinical-summary',
  anchoredIn: 'crash-recovery-test',
});

const repository = new AnchorsRepository(prisma);
const service = new AnchorsService(content, chain, repository);

try {
  await service.anchorDocument(documentId, version);
} catch {
  // The scripted exit(9) fires inside the broadcast hook; reaching here means
  // something else went wrong, and is reported via the non-zero exit code.
  throw new Error('anchorDocument returned before the scripted crash');
}
await prisma.$disconnect();
```

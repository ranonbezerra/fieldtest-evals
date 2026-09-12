# Transcript — 05-onchain-anchoring / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me think carefully about what's being asked.

The task is to build a complete solution for on-chain report anchoring in TypeScript + NestJS + Prisma + Postgres. The deliverables are as follows:

1. Prisma schema with uniqueness constraint (one anchor per (document, version))
2. `anchorDocument(documentId, version)` — canonical hash, prepare, write-ahead persistence of intent including tx identity, commit, then broadcast
3. `verify(documentId, version, content)` — recomputes the hash, returns proof (txId, block) or mismatch report
4. Confirmation worker that polls receipts and advances state
5. Recovery sweep that queries the chain first for anchors stuck in limbo; only if the chain has no trace, re-broadcast the same signed tx
6. Tests for the acceptance cases. Includes a test that crashes the process between broadcast and (naive) persistence
7. Documented canonicalization

Stack conventions from the system prompt:
- TypeScript strict, Node 20+, NestJS API, Prisma ORM, PostgreSQL, Vitest, pnpm, ESM `"type": "module"`.
- Layout:
```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```
- Layers: controller validates input and calls service, no business logic. Service holds the logic. Service has zero raw SQL and zero Prisma client calls (interesting — service calls repository). Repository is the only layer that touches the database.

Wait — "service has zero raw SQL and zero Prisma client calls" means the service must not import PrismaService directly; it must go through the repository. And the repository touches the database (via Prisma). The chain client is not a database, so the service may call the chain client directly.

- Naming: tables/columns are snake_case via Prisma's @map/@@map. Endpoints are kebab-case plural. TS files are kebab-case.role.ts. Classes are PascalCase.
- Error envelope: `{ "error": { "code": "snake_case", "message": "English", "details": {} } }` — details is an object and never null.
- Wiring: providers, exports, imports as needed.
- Migrations: every schema change ships with a migration. Hmm, "every schema change ships with a migration." So I should include a migration SQL file. Prisma migrations live in `prisma/migrations/<timestamp>_name/migration.sql` plus `migration_lock.toml`. Since I'm creating the schema from scratch, I should ship an initial migration. Let me write the `prisma/migrations/20250101000000_init/migration.sql` and `migration_lock.toml`.

Actually, wait — should I include the migration? The convention says "every schema change ships with a migration." Since I'm creating the schema, I should ship the initial migration. The migration SQL must match the schema.

- Tests: Vitest, test behavior not implementation. Never assert only that calls happened. Every test needs assertions.

Now, let me design the system.

## Domain model

**Anchor** (table `anchors`): one row per (document, version).
- `id` (uuid, PK)
- `document_id` (string)
- `version` (int)
- `content_hash` (string, canonical hash hex)
- `tx_id` (string, nullable until prepared? Actually prepare happens before persistence, so tx_id is known at creation time)
- `signed_tx` (string — encoded signed tx, so the same one can be re-broadcast)
- `status` (enum: PREPARED, BROADCAST_SENT, BROADCAST_UNKNOWN, CONFIRMED, FAILED)
- `block_number` (bigint/long, nullable)
- `receipt` (jsonb, nullable)
- `created_at`, `updated_at`
- Unique constraint: `@@unique([document_id, version])`

Status: at minimum prepared, broadcast-sent, confirmed, failed, plus broadcast-unknown (limbo). Let me define the enum:

- `PREPARED` — intent persisted (with tx identity), broadcast not yet attempted.
- `BROADCAST_SENT` — broadcast() returned successfully, receipt not yet seen.
- `BROADCAST_UNKNOWN` — broadcast() was attempted (timeout/error) but outcome unknown.
- `CONFIRMED` — receipt obtained, tx landed in a block.
- `FAILED` — terminal failure (e.g., chain says tx was rejected / receipt indicates failure).

Hmm, what about "broadcast returned an error"? If broadcast throws a timeout, it's unknown. If broadcast returns a deterministic rejection (e.g., chain said "insufficient funds"), it's a known failure. For the fake client, let me have broadcast either resolve or throw; a thrown error could be timeout-ish (unknown) or a definite rejection. To keep it simple and deterministic: broadcast throws `BroadcastTimeoutError` (unknown) or a definite error. Actually, let me define the chain client interface:

```ts
interface ChainClient {
  prepare(tx: AnchorTx): Promise<{ txId: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<BroadcastResult>;
  getReceipt(txId: string): Promise<Receipt | null>;
}
```

Where `AnchorTx` is something the anchor module builds: `{ data: string }` — the payload is the content hash (hex string) or a typed payload. For on-chain anchoring, the typical data payload is the hash bytes. Let me make the tx payload `{ documentId, version, contentHash }` and the fake's prepare computes a deterministic txId from it. But prepare should be "local and deterministic" — in a real chain client, prepare builds the tx and computes the hash. Let me keep the interface generic: `prepare(data: string) -> { txId, signedTx }` where data is the on-chain payload (canonical form of the content hash). Hmm.

Actually, let me define:

```ts
export interface ChainClient {
  /** Local and deterministic: the transaction identity exists before broadcast. */
  prepare(tx: { data: string }): { txId: string; signedTx: string };
  /** May time out with unknown outcome. Returns only that the tx was accepted for broadcast. */
  broadcast(signedTx: string): Promise<void>;
  /** Returns the receipt once the tx is included in a block, else null. */
  getReceipt(txId: string): Promise<Receipt | null>;
}

export interface Receipt {
  txId: string;
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}
```

Should prepare be sync or async? "Local, deterministic" — the spec writes `prepare(tx) -> {txId, signedTx}`. Let me make it a sync function in the interface (local computation, no I/O). That's a defensible reading: local means no network. Sync makes the flow trivially "identity exists before broadcast." But in NestJS everything is async-friendly; sync is fine. Actually, should I make it async for uniformity? Hmm. "Local, deterministic" strongly implies no I/O. Let me make it sync: `prepare(tx: AnchorTxInput): PreparedTx`. This is a markable assumption but reasonable. Actually, many chain clients have async signers (wallet RPC). But the spec says local and deterministic. Let me go sync and note the assumption. Hmm, "no RPC" — no real keys or RPC. So sync is fine.

Actually, wait — reconsider: is it safer to make the interface `Promise<{txId, signedTx}>`? The spec's acceptance says "an intent including tx identity is committed before `broadcast()` is called." Either way works. Sync is simpler for the crash test. Let me go sync.

`broadcast(signedTx)` — "may time out with unknown outcome." So it can throw a timeout error, or just hang. The service should treat a thrown error as BROADCAST_UNKNOWN (limbo) — because a timeout is the canonical case; but what if the error is a definitive rejection? To keep the state model clean and to match the spec's "at minimum: prepared, broadcast-sent, confirmed, failed. And a state for broadcast-attempted, outcome-unknown."

So:
- `broadcast` resolves → BROADCAST_SENT.
- `broadcast` rejects → BROADCAST_UNKNOWN (we don't know if it landed; the recovery sweep will ask the chain).

Then the `FAILED` state: from a receipt with status 'failure' (chain says it was included but the tx failed), or after max attempts? Let me keep it simple: if the receipt arrives with `status: 'failure'` → FAILED. Also, if the recovery sweep re-broadcasts and it fails definitively... hmm, let me keep it simple: a receipt failure → FAILED.

Also, should the service treat a thrown error that is clearly not a timeout (e.g., invalid tx) as failed? In our fake, broadcast only throws `BroadcastTimeoutError`. Let me define that the chain client can throw `ChainBroadcastError` with a `known` boolean? That's overengineering. Keep it: any error from broadcast → BROADCAST_UNKNOWN; recovery asks the chain. This matches "a recovery sweep that queries the chain first." Good.

**Canonicalization** (to be documented):

Define it clearly:

1. Input: the structured JSON content of the report (JS value, parsed from JSON text).
2. Serialize deterministically:
   - Object keys sorted lexicographically by UTF-16 code unit (i.e. `sort()` on string keys — deterministic; but better to sort by UTF-8 byte order? For ASCII keys it's the same. Let me define: keys sorted by UTF-16 code unit ascending — matches default string sort — and documented).
   
   Actually, the cleaner spec: sort by code point. Let me just say "sort lexicographically (UTF-16 code unit order) — JavaScript `Array.prototype.sort()` default." Fine for typical report keys (ASCII).
   
   - Numbers: serialize with a canonical number format — use JSON semantics: numbers serialize to the shortest decimal representation that round-trips (i.e., `JSON.stringify` of the number). Hmm, `JSON.stringify(1.0)` → "1". `JSON.stringify(1e21)` → "1e+21". To avoid scientific notation ambiguity, define: numbers are serialized in decimal without exponent? That gets complex for floats. The simplest defensible rule: "numbers are serialized using JSON.stringify's number serialization (the shortest string that round-trips to the same IEEE-754 double)." Document it: integers are serialized as-is; floats use the shortest round-trip representation. This is exactly what JSON.stringify does. Good — document as "JS number → shortest round-trip decimal (JSON.stringify semantics)."
   
   - Strings: serialized with JSON.stringify's escaping, and content is UTF-8 encoded.
   - `null`, `true`, `false`: as JSON literals.
   - Arrays: order preserved, elements canonicalized recursively.
   - No whitespace between tokens: compact form `{"a":1}`.
   - Unknown/undefined: keys with `undefined` values cannot appear in JSON; if content was parsed from JSON text there are no undefineds. If passed a JS object with undefined, JSON.stringify drops the key — canonicalization must drop too (document: undefined-valued keys are omitted, matching JSON.stringify of the object).
3. Encode the canonical string to UTF-8 bytes.
4. Hash: SHA-256, hex-encoded, lowercase. `sha256:<hex>`? Or bare hex? Let me use bare lowercase hex of SHA-256, and store the hash function as a constant `HASH_ALGORITHM = 'sha256'`. Maybe prefix: `sha256:abc...`? Auditors need the algorithm — since we're writing it down, bare hex + documented "SHA-256" is enough. Let me store bare hex and document the algorithm. Actually, a self-describing prefix is safer for the "auditor in 4 years." But the hash goes on-chain as tx data, so... the on-chain payload could just be the hash hex. Let me store the `content_hash` as bare lowercase hex SHA-256 and write the algorithm down in the docs. Keep it simple: bare hex.

The canonicalize function:

```ts
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Non-finite number');
      return JSON.stringify(value); // shortest round-trip
    case 'string': return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) {
        return '[' + value.map(canonicalize).join(',') + ']';
      }
      const keys = Object.keys(value).filter(k => (value as any)[k] !== undefined).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize((value as any)[k])).join(',') + '}';
    default:
      throw new Error(`Unsupported type in canonical content: ${typeof value}`);
  }
}

export function canonicalHash(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

Edge cases: number formatting — `JSON.stringify(0.1)` = "0.1", `JSON.stringify(100)` = "100". Good. `-0`? JSON.stringify(-0) = "0". Document it.

Sort: `Object.keys(value).sort()` — default sort is UTF-16 code unit order. Document.

I also need a place to "write it down" — the canonicalization must be stated. Let me put a full written spec in a section of a doc file. The deliverable says "documented canonicalization." Format constraint: the parser only reads the file blocks. "Prose between blocks is ignored, so keep it to nothing." So the documentation must be inside a file — e.g., a `CANONICALIZATION.md` file or a block in the repo. A README section or a dedicated doc `docs/canonicalization.md`? The convention says "do not create files not requested by the task." The task explicitly requests "documented canonicalization" as a deliverable, so a doc file is requested. Let me create `docs/canonicalization.md` — or maybe keep it in the repo root? A doc file is reasonable: `docs/canonicalization.md`. Hmm, or put the full spec as a block comment at the top of `src/anchoring/canonical.ts`. Both. The doc file is the "write it down" deliverable; the code file carries a condensed version. Let me do both: full spec in `docs/canonicalization.md`, code reflects it exactly.

## Prisma schema

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
  BROADCAST_UNKNOWN
  CONFIRMED
  FAILED
  @map(...)
}
```

Hmm — the enum value: Prisma maps enum values directly to the DB. I can use `@@map` for the table. For enum values, keep them in SCREAMING_SNAKE to match snake_case convention? The convention says tables/columns are snake_case. Enum values are stored in a column. `broadcast_unknown` is the snake_case value. Prisma supports mapping enum values:

```prisma
enum AnchorStatus {
  PREPARED        @map("prepared")
  BROADCAST_SENT  @map("broadcast_sent")
  BROADCAST_UNKNOWN @map("broadcast_unknown")
  CONFIRMED       @map("confirmed")
  FAILED          @map("failed")
}
```

Wait — does Prisma support `@map` on enum values? Yes, Prisma supports `@map` on enum values (since around 3.x). Yes: "Enums ... can be mapped with @map" — enum values can have `@map`. Let me double-check: Prisma docs: "You can define enum values and map them with @map" — I believe `@map` is supported on enum values. Yes, it's supported (prisma/prisma#10413, since 3.7 or so). I'm fairly confident. But to be safe, I could make the column a String instead of an enum — that sidesteps any doubt. Hmm. An enum gives type safety. Risk: if `@map` on enum values isn't supported in the Prisma version used, the schema breaks. It is supported: the Prisma docs on enums say:

```prisma
enum UserStatus {
  BANNED
  VERIFIED
  @map("VERIFIED")
  PENDING  @map("UNVERIFIED")
}
```

Yes, this is in the official docs. Good.

Model:

```prisma
model Anchor {
  id           String      @id @default(uuid()) @map("id")
  documentId   String      @map("document_id")
  version      Int
  contentHash  String      @map("content_hash")
  txId         String      @map("tx_id")
  signedTx     String      @map("signed_tx")
  status       AnchorStatus @default(PREPARED) @map("status")
  blockNumber  Int?        @map("block_number")
  receipt      Json?       @map("receipt")
  attempts     Int         @default(1) @map("broadcast_attempts")
  createdAt    DateTime    @default(now()) @map("created_at")
  updatedAt    DateTime    @updatedAt @map("updated_at")

  @@unique([documentId, version])
  @@map("anchors")
}
```

`version` is Int — report version, an integer. Fine. Or String? "versioned ... report" — int is natural. Let me use Int.

Also, `tx_id` should be unique? One anchor per (document,version) is the requirement; two different versions could in principle have the same tx? No — different content hashes produce different txs. Not needed; the required uniqueness is (document, version). I could also add `@@unique([txId])` — hmm, if a tx is re-broadcast... the txId is the same signed tx, same anchor row, no conflict. Across anchors, prepare is deterministic per (documentId, version, contentHash) → different anchors have different txIds. A unique txId constraint is defensible but not required; let me skip it to avoid over-constraining? Actually it adds safety: "exactly one anchor per (document, version)." The requirement is the pair. Let me keep only the pair uniqueness, as specified.

Now — where does the document itself live? The task is about anchoring reports; the platform "issues reports" — but our scope is the anchoring feature. `anchorDocument(documentId, version, content)` — wait, the task says `anchorDocument(documentId, version)` — hmm, variant A says `anchorDocument(documentId, version)` computes the canonical hash of the structured content. But the content has to come from somewhere. The L2 spec says "compute the canonical hash of the structured content." Where does the content come from? Options: (a) a documents table storing the structured JSON per version; (b) the caller passes the content.

`verify(documentId, version, content)` takes content explicitly — so verify receives the content from the caller (the auditor has their own copy). For anchoring, the platform would anchor the content it's issuing. Two clean designs:

1. A `documents` table: `documents (id, title?)` + `document_versions (id, document_id, version, content Json)` with unique(document_id, version). `anchorDocument(documentId, version)` loads the content from the table. This models "each issued version" — the platform has the content.

2. `anchorDocument(documentId, version, content)` — caller passes the content.

The variant says `anchorDocument(documentId, version)` — a 2-arg signature. So the content must come from storage → we need a documents/versions store. That's the most defensible reading: the platform stores the issued structured JSON, and anchoring hashes the stored structured content (the source of truth), not the PDF.

So schema:

```prisma
model Document {
  id          String   @id @map("id")
  createdAt   DateTime @default(now()) @map("created_at")
  versions    DocumentVersion[]
  anchors     Anchor[]
  @@map("documents")
}

model DocumentVersion {
  id          String   @id @default(uuid()) @map("id")
  documentId  String   @map("document_id")
  document    Document @relation(fields: [documentId], references: [id])
  version     Int
  content     Json
  createdAt   DateTime @default(now()) @map("created_at")
  @@unique([documentId, version])
  @@map("document_versions")
}
```

And anchors reference documentId + version (not a row id, to keep the anchor pair self-describing). Should Anchor hold a FK to document_versions? That would enforce the content's existence. But the requirement: "exactly one anchor per (document, version), enforced at the schema level" — that's `@@unique([documentId, version])` on anchors. I could also FK anchors to document_versions on (documentId, version), but Prisma composite FKs require `references([documentId, version])` — supported in Prisma? Composite referential constraints: Prisma supports them (references a unique constraint on a composite). Yes, Prisma supports composite FKs. But adds migration complexity; the unique on the anchors table is the required enforcement. Let me keep the anchors table with a simple FK to documents.document_id? Or no FK at all?

Let me think about what's cleanest while honoring "do exactly what the task asks." The task: anchor documents (reports). For the anchorDocument endpoint to work without content in the request, the platform must store the content. So `documents` + `document_versions` is needed. That's in scope — "each issued version must be anchored" implies the versions exist in the platform.

Alternatively — simpler — `anchorDocument(documentId, version)` and the content is fetched... no, we need a store. Let me include the two tables.

Should I expose endpoints to create documents/versions? The task doesn't ask for that, but without them, anchors can't be tested via HTTP, and the crash test needs a version row to exist. In tests, I can create version rows directly via the repository. The endpoint list in the task: anchorDocument, verify, plus worker/sweep. The discipline says don't create what's not requested. But a `POST /documents` to create a version is infrastructure for the feature to work at all... hmm. Let me think.

The crash test ("crash the process between broadcast and (naive) late persistence") — in our design, there is no "late persistence" after broadcast; the intent is persisted before broadcast. The test: "shows exactly one anchor and one tx identity after a crash." So the test: simulate the process dying immediately after broadcast() — i.e., kill between broadcast and the BROADCAST_SENT status update (a crash that happens after the broadcast but before the post-broadcast state transition). Then restart, run recovery, and show exactly one anchor with one tx identity and that the receipt resolves it.

How to simulate the "crash" in a test without an actual process death? Behaviorally: the fake chain client's broadcast() succeeds (tx lands), but the service is killed before persisting BROADCAST_SENT. We can simulate that by making the fake throw a special "process crash" error right after recording the broadcast — or, more simply and honestly: the fake records the broadcast as landed; the service's post-broadcast update crashes (e.g., inject a fault at the "post-broadcast persistence" point via a test hook). But "never assert only that calls happened; test behavior not implementation" — the fault injection is a test double concern, fine.

Cleaner approach: the crash test works at the service level with the fake:
- The fake client: `broadcast(signedTx)` → lands the tx (creates the receipt), then throws `ProcessCrashError`.
- The service catches the error from broadcast → marks BROADCAST_UNKNOWN (limbo) — wait, but a real process crash would die before the catch. Hmm.

If the process really dies between broadcast and catch, the DB row stays PREPARED (the pre-broadcast state), and the chain has the landed tx. On restart, the recovery sweep sees a PREPARED (or BROADCAST_UNKNOWN) anchor, queries getReceipt(txId) → found → CONFIRMED. Exactly one anchor, one tx identity.

To emulate "process dies mid-service-call," in the test I can interrupt the service after the broadcast. Since there's no actual process death, the most faithful emulation is: the fake broadcast() lands the tx and then throws a non-catchable... can't. Options:

Option A: A test hook on the service — no, that's testing implementation.

Option B: The fake broadcast throws; the service marks BROADCAST_UNKNOWN and returns an error to the caller. That models "timeout, outcome unknown" — but not a crash. The DB state differs: PREPARED (real crash) vs BROADCAST_UNKNOWN (timeout handled). Both are "stuck" states the recovery sweep handles. The acceptance case is: "a crash between broadcast and confirmation → restart recovers, one anchor total."

Hmm, for the crash test, I think the right emulation is: simulate process death by stopping the service right after the broadcast call, leaving the row in whatever state the crash leaves. Since we can't truly kill the process mid-function in a unit test, the standard approach: the fake client's broadcast() simulates the tx landing on the chain and then throws a `CrashError` that bypasses the service's error handling to simulate the crash? That's impossible — any error is catchable.

Alternative: structure the anchor flow in two phases:
1. `prepareAnchor` — compute hash, prepare, persist intent (PREPARED), commit.
2. `dispatchAnchor` — broadcast, update to BROADCAST_SENT or BROADCAST_UNKNOWN.

`anchorDocument` = phase 1 + phase 2. In the crash test, call phase 1, then call phase 2 with a fake broadcast that lands the tx and throws a crash error, and... the service catches it and marks BROADCAST_UNKNOWN. The state is slightly different from a true crash (PREPARED), but the recovery behavior is identical (limbo state → ask chain).

Honestly, I think the most defensible test is: emulate the crash by having the fake broadcast land the tx and then throw an error representing process death; the test verifies the recovery path from the resulting persisted state (PREPARED or BROADCAST_UNKNOWN — both are "stuck in limbo" from the chain's point of view) results in exactly one CONFIRMED anchor with one tx identity. And crucially, the test also shows that a *naive* design (persist after broadcast) would have lost the txId — we can't test the naive design; instead, we assert that our DB row has a tx_id and status stuck, and that the chain has the receipt, and after recovery: one anchor, status confirmed, txId unchanged.

Actually — let me reconsider. There's a cleaner way to do a true "crash": run the anchor flow in a child process? That's too heavy for Vitest without actual Postgres in tests. Tests will run against real Postgres? The convention says Vitest for tests; the DB is Postgres. In this eval, tests won't actually run (no shell), but they should be written correctly. I'll write tests that use the real service + real Prisma against DATABASE_URL (integration style), with the fake chain client. That's the honest way to prove the unique constraint (needs a real DB) and the recovery (needs a real DB).

For the crash test, the emulation: `fakeBroadcastLandsThenCrashes`:

```ts
// Simulate: chain accepts the tx (it will appear in a receipt), then the
// process dies before the service can persist any post-broadcast state.
fake.broadcaster = (signedTx) => {
  fake.land(txId);        // tx is on-chain now
  throw new ProcessCrashSimulated();
};
```

The service treats any broadcast error as BROADCAST_UNKNOWN (because from the caller's perspective the outcome is unknown). In a real crash the row would be PREPARED; in the simulation it's BROADCAST_UNKNOWN. Both are handled identically by the recovery sweep. I'll comment this clearly in the test: "A true SIGKILL would leave the row in PREPARED; here the simulated crash leaves BROADCAST_UNKNOWN — either way, a limbo state that recovery must resolve by asking the chain first."

Hmm, wait. Actually, can I do it even more faithfully? What if the service structure lets the crash happen *between* the broadcast() call and the subsequent transaction? I could wrap the service call and use a fault that... no. Let me accept the emulation and document it. Actually, there's another approach: the fake broadcast *hangs* (times out) — the service has a timeout around broadcast (e.g., Promise.race with a timeout). The broadcast timeout → the service marks BROADCAST_UNKNOWN. Meanwhile, the fake (simulating the chain) eventually lands the tx after the timeout. This is exactly the incident: "a broadcast() call timed out. The transaction was accepted by the chain."

So the crash/timeout test:
1. Create a document version.
2. Fake: broadcast(signedTx) → returns a promise that (a) lands the tx in the fake chain, (b) hangs (never resolves) — the service's timeout fires → BROADCAST_UNKNOWN.
3. `anchorDocument` returns/throws an error indicating unknown outcome (row persisted with txId).
4. Run the confirmation worker/recovery sweep: getReceipt(txId) → found → CONFIRMED.
5. Assert: exactly one anchor row, status confirmed, txId === the prepared txId, blockNumber set, and no second tx ever broadcast (fake.broadcast call count == 1).

This is faithful to the incident: broadcast timed out, tx landed, recovery confirms from receipt, no re-broadcast.

And the "did not land" case: broadcast times out, fake does not land; recovery: getReceipt → null → re-broadcast the same signedTx (assert broadcast called with the same signedTx string), then lands, then confirmed. Exactly one anchor.

OK, that covers the acceptance cases.

Now, does the service have a broadcast timeout? "broadcast(signedTx) (may time out with unknown outcome)" — the timeout is the chain client's behavior; the client may throw a timeout error or hang. To make it testable and robust, the service wraps broadcast in a bounded wait (configurable, env, default e.g. 30s). `Promise.race([client.broadcast(signedTx), timeout])` — if the timeout wins → mark BROADCAST_UNKNOWN. If the broadcast rejects → BROADCAST_UNKNOWN. If it resolves → BROADCAST_SENT. Note: even after a timeout, the pending promise may later resolve — that's fine, the outcome is unknown; the chain is the source of truth.

Broadcast timeout as an env var: `BROADCAST_TIMEOUT_MS`. Config is only from env vars. Good.

## Flow: anchorDocument

```
anchorDocument(documentId, version):
  1. Load document version row (content) → if missing, throw document_version_not_found
  2. Check existing anchor for (documentId, version):
       - If CONFIRMED: return the existing proof (idempotent? or reject?)
       
Hmm — "anchoring the same (document, version) twice → rejected by the database." So a second anchoring attempt must be rejected *by the database* (unique constraint). But if it's already confirmed, should we reject? The acceptance says rejected by the database. Design: anchorDocument creates the anchor row (the write-ahead intent). If an anchor already exists for the pair → the upsert would conflict. Let me define:
       - If a row exists: return an error `anchor_already_exists`? But the rejection must be "by the database." The unique constraint causes the create to fail → we translate the P2002 to a `anchor_conflict` error. That's "rejected by the database."
       
       However, for a CONFIRMED anchor, a second call would... still hit the unique violation. For idempotency, one might return the proof. But the acceptance explicitly says "anchoring the same (document, version) twice → rejected by the database." So: no idempotent shortcut; let the create fail with the unique violation → 409-ish error `anchor_conflict`. Hmm, but that seems unfriendly: re-anchoring a confirmed version → rejected. The acceptance is clear, so let me implement it: any existing anchor → the create fails at the DB → error. Wait, but if we check for existence first and return the proof for confirmed, we never hit the DB rejection for confirmed... The acceptance test: "anchoring the same (document, version) twice → rejected by the database." To prove the *schema-level* enforcement, the second call should reach the DB and be rejected. So: anchorDocument always attempts create (after computing/prepare); the race is caught by the unique constraint. For deterministic tests, the second call while the first is in-flight or after it: create → P2002 → rejected.

       Actually wait — a subtle point: should we *prepare* (obtain a txId) before or after the create? If prepare is local/deterministic, either order works. Order: load content → compute hash → attempt to create the intent row with status PREPARED (without txId?) or prepare first and then create with the txId.

The spec: (1) compute canonical hash, (2) prepare() to get {txId, signedTx}, (3) persist the intent including the tx identity, commit, (4) broadcast. So prepare is before persist. Fine — prepare is local/deterministic, no risk.

But if the create fails (P2002, someone already anchored), we have prepared a tx we never broadcast — harmless (local). Return the conflict error.

  3. After create (committed): broadcast the signedTx with a timeout.
       - Resolves → update to status BROADCAST_SENT (with attempts+1).
       - Times out/rejects → update to BROADCAST_UNKNOWN.
       - Returns the current state to the caller. If sent → the response is "anchoring in progress, txId." If unknown → an error? Or return with a flag.

What should the API return? On success (broadcast accepted): `202` with the anchor state. On unknown outcome: the anchor row exists in limbo; the endpoint should report that: maybe `202` with status broadcast_unknown and a message that recovery will resolve it, or a 504-ish error. Let me think about the error envelope: errors are the `{error: {code, message, details}}` shape. On broadcast-unknown, this isn't a request failure — the request did what it should (persisted the intent, attempted the broadcast). Let me return 202 with the anchor state (status broadcast_unknown), details including the txId. The caller can poll verify/status. Hmm, but "broadcast times out but landed → recovery confirms" — the endpoint response in that case: 202 anchor {status: broadcast_unknown, txId}. Fine.

Actually, let me define the endpoint response shape:

`POST /documents/:documentId/versions/:version/anchor` → the endpoint convention is kebab-case plural... "Endpoint: kebab-case, plural." Hmm, my route `POST /documents/:id/versions/:version/anchor` — the resource is anchors. A kebab-case plural endpoint: `POST /documents/{documentId}/versions/{version}/anchors`? That reads well: create an anchor for the version. Or `POST /anchors` with body {documentId, version}. The convention says endpoints are kebab-case plural — `/documents/:documentId/versions/:version/anchors` is plural and nested. Let me use:

- `POST /documents/:documentId/versions/:version/anchors` → anchorDocument. Response 201/202 with the anchor.
- `GET /documents/:documentId/versions/:version/anchors` → current anchor state? Not requested. Skip? `verify` is requested: `POST /documents/:documentId/versions/:version/verify` with body content → proof or mismatch. Kebab-case plural... "verify" is a singular verb. The plural rule is awkward for action endpoints; the convention says endpoint: kebab-case, plural. Hmm. Let me honor the spirit: collection-oriented where possible. verify as `POST /documents/:documentId/versions/:version/verification`? Ugly. Or `GET /anchors/:documentId/:version/verify`...

The convention is explicit: "endpoint: kebab-case, plural." Let me go with:
- `POST /documents/:documentId/versions/:version/anchors` (create anchor)
- `POST /documents/:documentId/versions/:version/anchors/verifications` (verify) — plural, kebab. A bit long but compliant. Hmm, "verifications" is weird.

Alternative: treat the whole thing as an anchors resource:
- `POST /anchors` body {documentId, version}
- `POST /anchors/verifications`? Also weird.

Honestly, I think `POST /documents/:documentId/versions/:version/anchors` and `POST /documents/:documentId/versions/:version/verification` — but the plural rule... The parser only cares about the file; the convention is a guideline for my choice. Let me go with:

- `POST /documents/:documentId/versions/:version/anchors` → create the anchor (anchorDocument).
- `POST /documents/:documentId/versions/:version/anchors/verifications` → verify. Hmm.

Let me reconsider: maybe a simpler REST: verify is really "check the anchor against the supplied content" — a sub-resource of the anchor. `POST /documents/:id/versions/:v/anchors/verify`... singular. Let me go with `verifications` plural. Wait, actually — hmm, "kebab-case, plural" might apply to top-level route segments (like /documents, /payouts — plural nouns). For action sub-routes there's discretion. I'll pick:

- `POST /documents/:documentId/versions/:version/anchors`
- `POST /documents/:documents/:documentId/versions/:version/anchors/verifications`? No, keep the first one.

Final:
- `POST /documents/:documentId/versions/:version/anchors` — anchorDocument
- `POST /documents/:documentId/versions/:version/anchors/verifications` — verify

OK.

Also, do I need an endpoint to create a document version? For the feature to be usable (and for the tests to seed), a version must exist. The task doesn't explicitly ask for it... "Build: 1. anchorDocument ... 2. worker/sweep 3. verify ... 4. uniqueness." The platform "issues reports as structured JSON" — the issue is the platform's existing capability. Without a create-version endpoint, the feature is untestable via HTTP; in tests I can seed via the repository. The discipline: "do exactly what the task asks. Do not create files not requested by the task." A `POST /documents/:documentId/versions` endpoint is arguably necessary infrastructure for the API to be usable end-to-end. Hmm. I'm leaning toward including a minimal version creation (needed for any real use and to demonstrate the flow in tests via the service). But is that "improving code I wasn't asked to change"? No, it's new. Risk assessment: including it is defensible (the anchor flow requires stored content; the task implies versions exist in the platform). I'll include a small `document` module? Or put it in the same `anchoring` feature? The layout is `src/<feature>/...`. I have one feature here: anchoring. Document versions are part of the anchoring domain (we anchor report versions). Let me keep it in one feature: `anchoring` with the module/controller/service/repository, plus a canonical utility file and a chain client interface + fake.

Hmm wait, the naming convention for files: `TS file: kebab-case.role.ts`. So `src/anchoring/anchoring.module.ts`, `anchoring.controller.ts`, `anchoring.service.ts`, `anchoring.repository.ts`. The extra files: `canonical.ts` (a utility — not a .role file; the rule is for the feature's role files; `canonicalize.ts` is fine), `chain-client.ts` (interface), and the fake is in the test dir? The fake is "a fake for tests" — but the main app must implement the chain client. "No real keys or RPC: implement against the interface with a fake for tests." So production wiring: I don't have a real client! So the app must wire something as the provider for ChainClient. Without a real client... provide an in-memory "reference" implementation? Or make the fake the default provider? "Implement against the chain client interface with a fake for tests" — my reading: the code depends on the interface; tests use the fake. In the repo, there's no actual L2 client to wire, so I'll ship the interface and wire the fake as the default implementation (marked clearly as a stub that must be replaced in deployment) — or, better: provide an `InMemoryChainClient` as a dev/placeholder implementation? That's inventing behavior.

Defensible: define `ChainClient` interface in `src/anchoring/chain-client.ts`, and the module provides a token-based injection: `@Inject(CHAIN_CLIENT)`. The AppModule provides it from env? Hmm. Let me keep it simple: the anchoring module has a `providers: [ { provide: CHAIN_CLIENT, useFactory: () => new InMemoryChainClient() } ]`? No — shipping a fake as the production default is wrong.

Cleaner: a `ChainClient` token, and in `app.module.ts` (or anchoring.module) a provider that reads an env var `CHAIN_CLIENT_MODE`... overengineering.

Most defensible minimal approach given "no real keys or RPC": the repo implements the interface; the only concrete implementation shipped is the test fake; in the app wiring, provide the token with a factory that throws at runtime if not configured? That breaks `npm run start`. Hmm.

Alternative reading: "implement against the interface with a fake for tests" = the *solution* is the interface + a fake for tests; the real client is out of scope ("no RPC"). So the app should still start and work with the fake. Let me ship the fake in `src/anchoring/fake-chain-client.ts` as a clearly-named in-process implementation for local development/tests and wire it as the default provider. The module exports the token so a real deployment can override it... Actually NestJS: a provider in a module can be overridden in a test module. In the main app, `ANCHORING_CHAIN_CLIENT`... Let me do this:

`src/anchoring/chain-client.ts`:
```ts
export interface ChainClient { prepare(tx: ChainTxInput): PreparedTx; broadcast(signedTx: string): Promise<void>; getReceipt(txId: string): Promise<ChainReceipt | null>; }
export const CHAIN_CLIENT = 'CHAIN_CLIENT';
```

`src/anchoring/fake-chain-client.ts`: an InMemoryChainClient implementing the interface, with hooks for tests (a configurable broadcaster, land behavior, receipt delay, timeout simulation). And in `anchoring.module.ts`:

```ts
providers: [
  { provide: CHAIN_CLIENT, useFactory: () => new InMemoryChainClient(), inject: [] },
  ...
]
```

With a `// ASSUMPTION: no real L2 client is in scope ("no real keys, no RPC"), so the in-memory implementation is the default provider; a real client replaces this provider in deployment.` Hmm, the instruction says to mark with a single `// ASSUMPTION:` comment where a truly unresolved symbol/decision matters. This is a design decision worth marking. Let me mark it in the module.

Actually — wait. Is the fake better placed in `test/`? "Implement against the interface with a fake for tests." The convention's layout has `test/<feature>.spec.ts`. The fake could live in `test/fake-chain-client.ts`. But then the app wiring needs some provider. If the fake is only in the tests, the main app has no ChainClient provider → the app can't start. Since no real client exists, the app can't run without the fake. So the fake (or a placeholder) must be in src, or the app wiring must be test-only. Since the convention wants main.ts/app.module (layout shows src/main.ts, src/app.module.ts), the app must be wired. Let me put the in-memory fake in `src/anchoring/` (name it `in-memory-chain-client.ts`), and have the tests use the same class (it's a fake for tests, but also the only available implementation). Hmm, "a fake for tests" — the class used by tests is the fake; it can live in src as a documented placeholder. Let me name it `in-memory-chain-client.ts` and add a header comment: in-process implementation of the ChainClient contract; serves as the default for development/tests and stands in for the L2 client. Tests configure it to simulate timeouts/landings.

That works. And the tests import it from src. Good.

## Worker and sweep

"Confirmation worker polling receipts and advancing state; a recovery sweep that resolves anchors stuck in broadcast-limbo by querying the chain first."

Implementation: NestJS `onApplicationBootstrap` or a `@Interval`-based processor. Convention: "a service, repository, or processor is listed in the module's providers" — "processor" is mentioned! So a worker as a processor class is fine. Use `@nestjs/schedule`? That adds a dependency. Or implement a simple setInterval in a service's onApplicationBootstrap. To minimize dependencies (only @nestjs/core, @nestjs/common, @nestjs/platform-express, prisma), I'll implement polling with `setInterval` inside a processor service that has `onApplicationBootstrap`/`onModuleDestroy`. Intervals from env: `WORKER_POLL_MS` (default 5000), `RECOVERY_SWEEP_MS` (default 60000).

The confirmation worker: fetch anchors with status BROADCAST_SENT (or PREPARED too? PREPARED means broadcast not yet attempted — if the process died between persist and broadcast, that's also a limbo case! Recovery should also pick up PREPARED rows: ask the chain? For a PREPARED row, broadcast was never attempted (if we die before the broadcast call, no tx is on the chain). But how do we distinguish "died after persist, before broadcast" vs "broadcast attempted, timed out, process died before marking unknown"? Both would leave the row PREPARED. The chain query answers: if a receipt exists (the tx landed somehow — e.g., a retry from another replica, or a crash after broadcast), confirm; if not, broadcast the signed tx (first broadcast attempt). So PREPARED is also handled by recovery: "query the chain first; if no trace, (re-)broadcast." This unifies: recovery handles PREPARED + BROADCAST_UNKNOWN (+ stale BROADCAST_SENT?).

The confirmation worker: handles BROADCAST_SENT: poll getReceipt(txId); if a receipt is found → CONFIRMED (blockNumber, receipt json) or FAILED (if receipt status failure). That's "advancing state."

The recovery sweep: handles PREPARED + BROADCAST_UNKNOWN (stuck in limbo): getReceipt(txId) first; if found → confirm/fail accordingly (no re-broadcast!); if not found → re-broadcast the same signedTx (bump attempts) → BROADCAST_SENT (if broadcast resolves) or stays/→ BROADCAST_UNKNOWN (if throws/times out).

Should the sweep also pick up BROADCAST_SENT rows that are old (in case the worker missed them)? The worker already polls BROADCAST_SENT continuously, so the sweep's scope = limbo states (PREPARED, BROADCAST_UNKNOWN). Let me keep the separation: worker = BROADCAST_SENT → receipt; sweep = PREPARED + BROADCAST_UNKNOWN → chain-first resolution.

Both need to be concurrency-safe (a worker tick and a sweep tick racing on the same row). Use a compare-and-set update: `prisma.anchor.updateMany({ where: { id, status: expected }, data: {...} })` — if count === 0, someone else moved it; skip. This is behaviorally important (two instances). Implement CAS in the repository: `advanceState(id, fromStatuses, toStatus, data)`.

CAS on the repository for atomicity:

```ts
async transition(id: string, from: AnchorStatus[], to: AnchorStatus, data?: Partial<...>): Promise<boolean>
  → updateMany where: { id, status: { in: from } } data: { status: to, ...data, } → count>0
```

Good, this is the repository-level atomic guard.

## Service logic

`AnchoringService`:

- `anchorDocument(documentId, version)`:
  ```
  const dv = await repo.findVersion(documentId, version); // throws document_version_not_found
  const contentHash = canonicalHash(dv.content);
  const prepared = chainClient.prepare({ data: anchorPayload(documentId, version, contentHash) });
  // Write-ahead: persist intent before broadcast
  try {
    const anchor = await repo.createAnchor({ documentId, version, contentHash, txId, signedTx, status: PREPARED });
  } catch (e) {
    if (Prisma unique violation) throw new ConflictException → error code anchor_conflict ("anchor_already_exists"?);
  }
  // broadcast
  const outcome = await this.broadcastWithTimeout(anchor.signedTx);
  if (outcome === 'sent') await repo.transition(id, [PREPARED], BROADCAST_SENT, {attempts+1})
  else await repo.transition(id, [PREPARED], BROADCAST_UNKNOWN, {attempts+1})
  return the anchor state;
  ```

Wait — attempts: initial create attempts=0; increment on each broadcast attempt. Let me create with `broadcast_attempts: 0` and increment on each broadcast attempt.

The error code for the double-anchor: `anchor_already_exists`. Message: "an anchor already exists for this document version." details: {documentId, version}. And it comes from the DB unique violation (P2002) — the service catches Prisma's `Prisma.PrismaClientKnownRequestError` with code 'P2002' and translates. But wait — "service has zero ... Prisma client calls." Catching Prisma's error class in the service — is that a "Prisma client call"? The import of Prisma for error codes is a gray area. To keep the service Prisma-free, the repository should translate DB errors into domain errors before the service sees them. Better layering: the repository catches P2002 and throws a domain `AnchorConflictError` (a custom class with a code). The service throws/propagates it; the global exception filter maps domain errors to the envelope.

So I need: a `src/common/` error infrastructure? Convention layout only shows feature files, but the error envelope is global: a global exception filter + HttpException subclasses. Where to put it? `src/common/errors.ts` + `src/common/error-handler.ts`? The layout convention is for features; shared infrastructure is needed (the envelope is a contract). Let me add:

- `src/common/exceptions.ts`: domain error classes with a `code` (AnchorConflictError, DocumentVersionNotFoundError, AnchorMismatchError?, etc.)
- `src/common/exception-filter.ts`: a global `AllExceptionsFilter` producing the envelope.

The filter maps:
- Domain error (with a `code`) → appropriate HTTP status (404/409/422), envelope with the code.
- HttpException → 4xx with a generic code? Map common ones: BadRequest → validation_error, etc.
- Unexpected → 500 `internal_error`, details {}.

HTTP status per code:
- document_version_not_found → 404
- anchor_not_found → 404
- anchor_conflict → 409
- invalid_content / canonicalization failure → 422 (`invalid_anchor_content`)
- broadcast_unknown → not an error (202) — but anchorDocument might return an error when the broadcast outcome is unknown? Decided: return 202 with the state. Hmm, let me reconsider: from the caller's perspective, "anchoring" is in progress; a 202 with the anchor state is clean. If the outcome is unknown, the state field says broadcast_unknown; the recovery resolves it. OK.

Actually wait — should the response be 202 in all cases? The anchor is created; broadcast accepted → 202 "accepted, anchoring in progress" (confirmation is async). Confirmed is a later state. So: 201 or 202. Let me use 201 Created with the anchor object (which includes the txId and status). Either works. Let me go with 201.

- verify → 200 with the proof or a mismatch report (200 with a body? mismatch is a valid response, not an error — it's a report). "Returns the anchor proof (txId, block) or a mismatch report stating what differs." So a 200 with `{ match: true, proof: {...} }` or `{ match: false, mismatches: [...] }`. Not an error envelope. Good.

Verify logic:
```
verify(documentId, version, content):
  const anchor = await repo.findAnchor(documentId, version); // if not, anchor_not_found (404)
  const dv = await repo.findVersion(documentId, version); // must exist to compare? the anchor implies the version existed... could the version have been deleted? Let me keep versions non-deletable. But verify takes content from the caller — does it need the stored content? "Recompute the hash from the supplied content and return the anchor proof or a mismatch report stating what differs."
  
  So: suppliedHash = canonicalHash(content). Compare to anchor.contentHash.
  - If anchor is not CONFIRMED: return a report of "anchor not confirmed yet" state — the proof can only be txId+block once confirmed. What to return? A mismatch report "what differs" — hmm. If the hash matches but the anchor is pending, return a pending status + txId (no block yet). If the hash doesn't match, a mismatch report: which fields differ: the contentHash mismatch; and if the stored content differs from the supplied content, we can also report differing keys/paths! "A mismatch report stating what differs" — nice touch: if the hashes differ, compute a structural diff between the stored content (from document_versions) and the supplied content, listing paths. That's genuinely useful for auditors.
  
  So verify returns:
  {
    documentId, version,
    match: boolean,
    status: 'confirmed' | 'pending' | 'failed' | ...,
    proof: { txId, blockNumber, blockHash } | null,
    differences: [] | [{path, expected, actual}]
  }
  ```

  If the hash matches: proof (if confirmed) or pending with the txId. If the hash mismatches: differences list (path-level diff between stored content and supplied content, plus the hash values). Let me implement a small `diffCanonical(a, b)` that returns paths where values differ. Keep it bounded: compare via the canonicalized traversal.

The diff implementation: recursively walk both values; collect `path` (JSON-path-ish like `a.b[2].c`), `stored`, `supplied` for the first difference at that path. If one side is missing, the value is `undefined`-ish → represent with a sentinel? In JSON output, use the actual values; for a missing key, the value `null` with a "missing" flag? Keep it simple: the differences entry: `{ path, stored, supplied }` where either may be absent (use the `undefined`-omitted JSON key). Hmm, JSON can't express absent; let me use `{ path, stored, supplied, kind: 'value_mismatch' | 'missing_in_supplied' | 'missing_in_stored' }`.

- Also verify when no anchor exists → 404 anchor_not_found (error envelope). Because "auditors querying us get 'not anchored'" is exactly the complaint in the incident... but verify should tell auditors. Hmm: verify returns a proof or a mismatch report. If not anchored → is that a mismatch? I think a 404 with the code `anchor_not_found` is correct — the endpoint is about the anchoring proof for a (doc, version). Fine.

- Controller validation: documentId is a non-empty string, version is a positive integer, verify's body has a `content` that is an object (JSON). Use class-validator? That adds a dependency (@nestjs/mapped-types? no — class-validator + class-transformer). The convention doesn't forbid extra deps, but minimal is better. Let me validate manually in the controller (the controller "validates input"): parse version with `Number`, check `Number.isInteger(v) && v >= 1`, content must be an object. Throw BadRequestException → the filter maps to `validation_error`. Manual validation keeps deps light.

## The Prisma layer

`PrismaService` — the standard NestJS Prisma service (extends PrismaClient, onModuleInit, onModuleDestroy). Put it in `src/prisma/prisma.module.ts` + `prisma.service.ts`? The layout convention shows only feature folders; but PrismaService is infrastructure. The repository "is the only layer that touches the database" — via PrismaService. Let me add `src/prisma/prisma.module.ts` (Global? or imported by the anchoring module) and `prisma.service.ts`. To honor "a provider used by another module is exported from its own module and imported by the other" — make the PrismaModule non-global, exported, and imported by the anchoring module. That's exactly the wiring convention.

`AnchoringRepository` (in `src/anchoring/anchoring.repository.ts`): methods:
- `findVersion(documentId, version)` → DocumentVersion | null
- `createVersion(documentId, version, content)` → for seeding; used by the `POST` endpoint for versions? If I include a version creation endpoint... let me decide: YES, include a minimal `POST /documents/:documentId/versions` (upsert? no — create; a version row = an issued report version; a conflict → version_conflict error). Hmm wait, is that "not asked"? Let me re-read the task: "A healthtech platform issues versioned clinical/administrative reports as structured JSON rendered to PDF." The platform issues reports — the content store is the platform's existing thing. For our feature to function, the version content must be accessible. The task's anchorDocument(documentId, version) signature (no content) forces a content store. So a way to create versions is needed for the feature to be demonstrable. Let me include it — it's the minimum the feature requires, and I'll keep it lean (a single endpoint + a repo method). I think this is the right call; without it, nothing works end-to-end.

  Hmm, but strictly "do not create files not requested by the task" — a file, not an endpoint. The endpoint goes in the same controller file. OK, one extra endpoint. Fine.

- `createAnchor(...)` → Anchor (throws AnchorConflictError on P2002)
- `findAnchor(documentId, version)`
- `listPendingAnchors(statuses, limit)` → for the worker/sweep
- `transition(id, from[], to, data)` → boolean (CAS)
- `findById(id)`

CAS via updateMany — good.

## Chain client fake details

`InMemoryChainClient`:
```ts
class InMemoryChainClient implements ChainClient {
  private receipts = new Map<string, ChainReceipt>();
  private knownTx = new Set<string>(); // tx the "chain" has seen
  private blockCounter = 0;
  // test hooks:
  broadcastBehavior: (signedTx) => Promise<void>; // default: resolves, marks known
  receiptDelayMs?: number;
  
  prepare(tx: ChainTxInput): PreparedTx {
    const txId = 'tx_' + sha256(canonicalize(tx)).slice(0, 32); // deterministic
    const signedTx = 'signed:' + txId; // deterministic
    this.knownTx.add(txId); // prepare is local; chain doesn't know until broadcast
    return { txId, signedTx };
  }
  async broadcast(signedTx) {
    await this.broadcastBehavior(signedTx);
  }
  async getReceipt(txId) {
    // simulate inclusion in a block after a delay:
    ...
  }
}
```

Let me design the fake more concretely for the acceptance scenarios:

- Default `broadcast`: resolves; marks the tx as "landed" with a receipt (blockNumber++). Or, make landing a separate step? In the incident, broadcast returns after acceptance; inclusion in a block happens later. For the "sent → worker confirms" flow, the receipt should appear after a broadcast (perhaps after a tick). Let me make the default: broadcast(signedTx) → tx becomes "accepted"; the receipt becomes available after the next `mine()` / a delay. More simply: the fake keeps a `pending` set; the default broadcast behavior adds to pending; `getReceipt` first calls `this.mine()`? No — time-based: the fake lands the tx `receiptDelayMs` after broadcast (default 0 → immediate). For the confirmation worker test: broadcast resolves (status BROADCAST_SENT), then the worker polls getReceipt → after delay, receipt available → CONFIRMED. With a delay of 0, it's immediate. Fine.

- Timeout simulation: the test sets `client.simulateBroadcast = (signedTx) => { land(signedTx); return new Promise(() => {}); }` — never resolves (hangs) → the service's timeout fires → BROADCAST_UNKNOWN. The chain has the landed tx (a receipt exists). Recovery: getReceipt → found → CONFIRMED. No re-broadcast (assert broadcast called exactly once).

- Non-landing timeout: `simulateBroadcast = (signedTx) => new Promise(() => {})` without landing. Recovery: getReceipt → null → re-broadcast the same signedTx via the *default* path? After the sweep re-broadcasts, the test switches the behavior to normal (the tx lands). Then the worker confirms. Assert: broadcast was called twice with the *same* signedTx string; one anchor row; one txId.

Hmm wait — note: the sweep re-broadcasts via `client.broadcast(sameSignedTx)`. In the fake, the "chain" is identified by txId — re-broadcasting the same signedTx = same txId (the fake derives txId from the signedTx content). So the chain can't double-count. Let me have the fake keep the txId ↔ signedTx mapping: `prepare` registers the mapping. `broadcast(signedTx)`: derive/lookup the txId; if the tx is already landed, the receipt exists (idempotent — real chains deduplicate by tx hash). Good, that models "resending cannot become a second anchor."

- The crash test: `simulateBroadcast = (signedTx) => { land(signedTx); throw new Error('process crashed'); }` — synchronous throw → the service treats it as a rejection → BROADCAST_UNKNOWN. A row with a txId exists (write-ahead). Recovery confirms. Assert: one anchor, one txId, confirmed, block set, broadcast called once. Comment: a real SIGKILL leaves PREPARED; the simulation leaves BROADCAST_UNKNOWN; both are limbo states that the sweep resolves chain-first.

Hmm, actually — could I make the crash simulation leave PREPARED for maximum fidelity? That would require the service's post-broadcast update not to run. The service always updates. To leave PREPARED, the "crash" would need to kill the process. Can I do a real child-process crash in Vitest? A test that spawns a child process running a small script that connects to the real DB, prepares, persists, broadcasts against the fake... but the fake is in-process — the child can't share the fake chain state with the parent. Unless the fake's "chain" is persisted (file-backed). That's a lot of machinery. The incident's acceptance: "a crash between broadcast and confirmation → restart recovers, one anchor total." A BROADCAST_UNKNOWN emulation exercises exactly the recovery path from a persisted limbo state with the tx identity — the essential proof (txId persisted before broadcast; recovery asks the chain). Let me go with the emulation and comment it clearly. This is the most defensible without process-fork machinery.

## State machine summary

| State | Meaning |
|---|---|
| prepared | intent committed (tx identity known), broadcast not yet attempted |
| broadcast_sent | broadcast() returned OK; awaiting receipt |
| broadcast_unknown | broadcast attempted, outcome unknown (timeout/error) |
| confirmed | receipt received, tx succeeded in a block |
| failed | terminal (receipt indicates failure) |

Transitions:
- create → prepared
- prepared → broadcast_sent (broadcast OK)
- prepared → broadcast_unknown (broadcast threw/timed out)
- broadcast_sent → confirmed (receipt success)
- broadcast_sent → failed (receipt failure)
- broadcast_unknown → confirmed (sweep: receipt found success)
- broadcast_unknown → failed (sweep: receipt found failure)
- broadcast_unknown → broadcast_sent (sweep: no receipt → re-broadcast OK)
- broadcast_unknown → broadcast_unknown (re-broadcast failed/timed out; attempts++)
- prepared → broadcast_sent/unknown (sweep on a stale prepared: chain-first — if a receipt exists → confirmed; else broadcast)

Should the worker handle `prepared`? No — the worker handles broadcast_sent. The sweep handles prepared + broadcast_unknown. A prepared row older than X (stuck) → the sweep broadcasts. But note: a freshly created anchor that's in-flight within the same service call (between create and broadcast) — the sweep might pick it up concurrently and double-broadcast. The service's own broadcast happens right after the create; a sweep with an age threshold (e.g., older than 60s) avoids racing with in-flight work. Add `STUCK_AFTER_MS` env (default 60000): the sweep only picks up limbo rows with `updated_at < now - stuckAfter`. That's the "stuck" filter — good behavior (a "recovery sweep that resolves anchors stuck in broadcast-limbo").

In tests, the stuckAfter threshold would slow the tests... let me make it injectable/small (env override or a processor constructor param). The processor takes a config object (default from env); tests construct it directly with a small threshold. Tests don't run Nest's bootstrap (test the service + processor as plain classes with the fake + real Prisma). Actually, should the tests boot the full Nest app (Test.createTestingModule)? For the controller-level tests (validation, envelope), Test.createTestingModule with the real Prisma (needs DB) is fine. But heavy. Let me think about the test scope.

## Test plan (test/anchoring.spec.ts)

Tests need a real Postgres (DATABASE_URL). Set up in beforeAll: instantiate PrismaClient directly? Or a Nest testing module? Let me use Nest's Testing module (idiomatic in NestJS, "test behavior" via controller + service + processor with the fake chain client, overriding the CHAIN_CLIENT provider with a new InMemoryChainClient). DB setup: beforeAll → `await prisma.$connect()`; clean the table (deleteMany anchors, document_versions, documents); afterAll → disconnect + clean.

Wait — but "test behavior not implementation. Never assert only that calls happened." Assertions on DB state (rows, status, uniqueness) are behavioral.

Test cases (mirroring the acceptance):

1. **Write-ahead: intent with tx identity is committed before broadcast is called.**
   How to prove order behaviorally? A fake that *waits* (hangs) on broadcast; while it's hanging, assert that the DB already has a row with the txId (status prepared). Then let it resolve → the row moves to broadcast_sent. That's behavioral: during a hung broadcast, the row exists with a txId.
   ```
   let release: () => void;
   client.simulateBroadcast = (st) => new Promise(res => { release = res; client.land(st); });
   const p = service.anchorDocument(...); // don't await yet... 
   ```
   Hmm — the service awaits broadcast before returning. So: `const p = service.anchorDocument(...)` (don't await), poll the DB until the row appears with a txId and status prepared (a loop with a short sleep), assert the txId matches the prepared one (deterministic — computable via client.prepare? The test can call `client.prepare` with the same input to predict the txId — or read it from the row and check it's non-null). Then release → await p → row is broadcast_sent. Assertions: the row existed with a txId before the broadcast completed.

2. **Broadcast times out but landed → recovery confirms from the receipt, no re-broadcast.**
   - Behavior: land + hang. anchorDocument resolves with status broadcast_unknown (after the service's broadcast timeout — set a small timeout via config for tests, e.g., 50ms).
   - Run a sweep tick (call the processor's sweep method directly? "test behavior not implementation" — calling `processor.runSweepOnce()` as a public behavior of "run one recovery pass" is fine; alternatively, wait for the interval tick with a small poll interval. Directly invoking a single-pass method is cleaner and deterministic. Let me give the processor a public `tick()`-ish method: `runConfirmationPass()` / `runRecoveryPass()`. The interval calls them; the test calls them. That's testing the pass's behavior — acceptable (it's a unit of behavior, not an internal detail).
   - After the sweep: the row is confirmed, blockNumber set; assert broadcast was called exactly once (the fake counts broadcasts per signedTx); no second anchor.

3. **Broadcast times out and did not land → re-broadcast the same signed tx, one anchor.**
   - Behavior: hang, no landing. anchorDocument → broadcast_unknown.
   - Sweep pass 1: getReceipt → null → re-broadcast (broadcastCount=2, same signedTx) → the behavior now lands + resolves (switch the behavior mid-test: the sweep's re-broadcast uses the default behavior? Let me set the behavior to "land and resolve" before the sweep: `client.setBroadcast((st) => { client.land(st); return Promise.resolve(); })`). Then the row is broadcast_sent; the receipt exists.
   - Confirmation pass → confirmed. Assert: one anchor row, the same txId, the broadcast called with the same signedTx string both times, block set.

4. **A crash between broadcast and confirmation → restart recovers, one anchor total.**
   - Behavior: land + throw (simulating a crash after the chain accepted it). anchorDocument → broadcast_unknown (a real crash would leave prepared; a comment explains).
   - "Restart": create a new service + processor instance (new PrismaClient too? a new PrismaService instance — to emulate restart, instantiate a new AnchoringService with the same repository/prisma and a new InMemoryChainClient? Wait — after a real restart, the in-memory fake is gone! The chain state (landed tx) must survive the "restart." Hmm!
   
   This is a problem with the in-memory fake: on process restart, a real chain retains the tx, but the in-memory fake is gone. For the "restart" test, the fake's chain state must persist across the simulated restart. Solution: give the fake a persistent "chain store" that can be shared across fake instances (e.g., a module-level singleton chain state in the fake, or pass a shared store object to two fake instances). Let me design: `InMemoryChainClient` takes an optional `chain` (an InMemoryChainState) in its constructor; the test creates one `chain` state, fake A = new InMemoryChainClient(chain) (process 1), simulates a crash, fake B = new InMemoryChainClient(chain) (process 2, "restart") — the same chain state, a new client. The service/processor are re-instantiated with fake B. That faithfully emulates a restart (the app state is lost, the chain is not).
   
   - After restart + a sweep pass: the row is confirmed via getReceipt on the same chain state. Assert: exactly one anchor row in the DB, one txId, broadcast call count on the chain == 1 (the chain state counts accepted txs; the re-broadcast count stays 1 since recovery found the receipt).

   The InMemoryChainState: a Map of txId → receipt, a broadcast counter, a land function. The fake client wraps a state.

5. **Anchoring the same (document, version) twice → rejected by the database.**
   - anchorDocument succeeds (broadcast sent/unknown/confirmed — let me use a fast default). Call anchorDocument again → expect an error `anchor_conflict` (409 if via controller; via the service, an AnchorConflictError). Assert the thrown error's code. Additionally, at the schema level: two raw creates conflict — that's inherent; the P2002 translation is the DB doing the rejection. To be even more "schema-level," the test could try two concurrent anchorDocument calls and show exactly one succeeds. Concurrency: `Promise.all([anchor(), anchor()])` → one resolves, one throws conflict. Both compute the same txId (deterministic prepare) — but the second create fails on the unique (documentId, version). Assert: one anchor row, one tx identity (the txId is the same anyway), one error. A nice proof. Let me do the sequential second-call version (deterministic) plus the row count assertion.

   Also, a unit-level uniqueness proof: `repo.createAnchor` twice → the second throws. But that's implementation. The service-level concurrent test is behavioral. Let me do: call twice concurrently; exactly one succeeds; the DB has exactly one row; assert the error code of the failure.

6. **verify returns proof for matching content, mismatch report otherwise.**
   - Seed a version with content C; anchor; confirm (default fast: after a confirmation pass).
   - verify(documentId, version, C) → match true, proof {txId, blockNumber} matches the row.
   - verify(documentId, version, changed C') → match false, differences list is non-empty, paths point to the changed fields, the hashes differ. E.g., change a value and add a key. Assert the paths are correct.
   - verify with content that matches the hash but the anchor is pending → match true, pending status, no block yet. (An extra behavior; fine.)
   - verify when no anchor → anchor_not_found error (404).
   - verify when the version doesn't exist → document_version_not_found? Which precedence? Let me check the anchor first? If the anchor doesn't exist but the version does → anchor_not_found. If the version doesn't exist → document_version_not_found. Let me check the version first (content store), then the anchor. Hmm: an auditor sends content for a doc/version; the platform says "that version was never issued" (404 document_version_not_found) vs "it was issued but never anchored" (404 anchor_not_found). Both 404, different codes. Check the version first. OK.

7. **Controller-level envelope test** (via the Testing module + supertest? No, no supertest dep — call the controller methods directly? That's implementation-ish but standard without HTTP deps. Hmm, "test behavior" — HTTP status + envelope is behavior. Without supertest, I can test the exception filter + controller: invoke the controller method with invalid input → expect an HttpException; run the filter to produce the envelope? More simply: a dedicated small test for the filter: `filter.catch(err, host)` → response json shape with code/message/details. And the controller validation: `controller.anchor('doc-1', 'abc')` (bad version) → throws a BadRequestException → the filter maps it to code `validation_error` with 400. I could also boot the full app with Test and use `app.inject`? Does Nest have a built-in `app.getHttpServer()`... does the `INestApplication` from Testing have `.inject()`? No — `app.inject` exists only on the Express app via supertest. Nest's testing docs use supertest. Without the dep, I can call `app.getHttpServer()` and use Node's fetch (Node 20 has global fetch) against the listening server! `const server = await app.init(); const url = await app.getUrl(); fetch(url + '/documents/x/versions/abc/anchors', {method:'POST'})`. That's a real HTTP test with zero extra deps.

   Let me include one HTTP-level test: POST with an invalid version → 400 envelope `{error:{code:'validation_error',...}}`; POST with a missing version → 404 envelope; and a successful anchor → 201. That verifies the envelope contract end-to-end. Use the global fetch, base URL from `app.getUrl()`. I'll need `app.listen(0)`.

   Hmm, this test needs a full Nest bootstrap with the real DB. OK.

Let me not over-scope: the acceptance test list is 6 items; plus an HTTP envelope sanity. Let me write:

- test/anchoring.spec.ts — the main behavioral suite (service + processor + repository + real DB + fake chain).
- test/api.spec.ts? Or a second file `test/anchoring-api.spec.ts` for HTTP envelope checks. The convention layout: `test/<feature>.spec.ts` — singular per feature; two spec files are fine (`test/anchoring.spec.ts`, `test/anchoring.api.spec.ts`).

Hmm, do I want two Nest test modules? The API spec needs the controller + filter; the main spec can use the same testing module with the controller. Actually, let me put everything in one spec file with describe blocks; fewer files. But the module setup: I need a Testing module with PrismaModule, AnchoringModule? If I import AnchoringModule, its CHAIN_CLIENT provider (the default in-memory) is used — I want my own fake with the shared chain state → override the provider: `{ provide: CHAIN_CLIENT, useValue: fake }` in the testing module's override... but the module's own provider would be shadowed by the override — Test.createTestingModule({imports:[AnchoringModule]}).overrideProvider(CHAIN_CLIENT).useValue(fake). Yes.

But wait — the worker/processor with an interval would run during the tests (onApplicationBootstrap). In the testing module, bootstrap triggers the processor's interval → background ticks during tests → flakiness (a sweep with a small stuckAfter might interfere). Mitigation: the processor's default interval is from env; in tests, set env to a large value (e.g., POLL_MS=1h) before creating the module, or have the processor read the config with a constructor injection and have the test module provide a config with a large interval, and never call listen() (only init()... onApplicationBootstrap fires on init). I'll use `app.init()` for the API test and set env to a large interval. Also `app.close()` in afterAll.

Alternatively, the processor takes the interval in the constructor with a default from env, and the test module overrideProvider for the processor? The processor is also a plain class — I can construct it manually in the service spec (no Nest) for the pass tests: `new AnchoringWorker(repo, client, {pollMs: 1, ...})` — hmm, the interval still starts. Let me design the processor: constructor(repo, chain, config), `onApplicationBootstrap()` starts the interval, `onModuleDestroy()` clears, and public methods `runConfirmationPass()`, `runRecoveryPass()`. In tests, I construct it with config `{ pollMs: Infinity }`? An `setInterval(ms=Infinity)` — does it work? setInterval(Infinity) clamps to 1ms — bad. Use `pollMs: null` → skip interval start when null/0. Let me define the config: `{ confirmationPollMs?: number; recoverySweepMs?: number; stuckAfterMs: number; broadcastTimeoutMs: number }` — if the interval is undefined, the processor doesn't self-schedule (it's scheduled by bootstrap only when the value is present). In the service spec, I construct it with no intervals and call the passes directly. In the API spec (full module), the env default gives a 5s/60s interval — harmless during a short test (stuckAfter is 60s default, so the sweep won't touch fresh rows; the confirmation pass might confirm rows — actually beneficial/harmless; but it could interfere with test 2's "no re-broadcast" assertion? The confirmation pass only reads receipts; the sweep doesn't fire on fresh rows (stuckAfter 60s). The confirmation pass on a row in test 1 (broadcast_sent) → confirms — fine, the assertion is about the row's eventual state anyway. OK, but note: the API test's anchor → the worker confirms it within 5s — the test doesn't assert on that. Fine.

Hmm, actually a simpler decision: in the API test, set env `ANCHORING_CONFIRMATION_POLL_MS=3600000` etc. before module creation. Clean.

Wait, also env-based config: "config comes only from env vars." So the config is read from process.env at provider construction time: a small `AnchoringConfig` provider (a factory that reads env, with defaults). The service gets the config (broadcastTimeoutMs). The processor gets the config (intervals, stuckAfter). In tests, I can override the config provider or construct the classes directly with an explicit config object. Let me make the config a plain object passed in the constructor (no DI class), and the module's provider factory builds it from env. The service spec constructs classes directly: `new AnchoringService(repo, chain, {broadcastTimeoutMs: 50})`. The repo: `new AnchoringRepository(prisma)`. prisma: a real `new PrismaService()`? PrismaService extends PrismaClient — instantiate it and `$connect`. Or use the raw PrismaClient directly in the tests? The repository takes a PrismaService type... let me have the repository depend on an interface? Overkill — the repository injects PrismaService (concrete). In the test, I create `new PrismaService()`, connect, pass it. PrismaService's onModuleInit calls $connect — in a manual construction, I can call `prisma.$connect()` myself (the hook doesn't fire without Nest lifecycle; calling $connect manually is fine... but PrismaService.onModuleInit calls $connect — if I later use it in a Nest module, it connects again — PrismaClient.$connect is idempotent-ish (resolves if already connected). Fine.

Now — the Prisma client import: `@prisma/client`. The repository imports `PrismaService` from `../prisma/prisma.service`. PrismaService:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

Standard.

ESM + Prisma: `import { PrismaClient, Prisma } from '@prisma/client'` works.

## Error details

Envelope: `{ "error": { "code": "...", "message": "...", "details": {} } }` — details is an object, never null.

Domain exceptions (in `src/common/exceptions.ts`):

```ts
export class DomainException extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus: number, readonly details: Record<string, unknown> = {}) { super(message); }
}
export const documentVersionNotFound = (documentId, version) => new DomainException('document_version_not_found', `...`, 404, {documentId, version});
...
```

Or concrete classes. Let me make small factory functions + one class. Codes:
- `document_version_not_found` (404)
- `anchor_not_found` (404)
- `anchor_conflict` (409)
- `validation_error` (400) — for controller input validation
- `invalid_anchor_content` (422)? Canonicalization failure (a non-finite number) → `invalid_anchor_content` 422. The verify content is the same. Let me name it `canonicalization_failed`? `invalid_anchor_content` is clearer.
- `internal_error` (500) fallback.

The filter (`src/common/all-exceptions.filter.ts`):

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception, args) {
    const ctx = args.switchToHttp();
    const res = ctx.getResponse();
    let status = 500, code = 'internal_error', message = 'internal server error', details = {};
    if (exception instanceof DomainException) {...}
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      // derive code: BadRequest → validation_error; NotFound → not_found; ...
    }
    res.status(status).json({ error: { code, message, details } });
  }
}
```

HttpException mapping: use the response object if it's our shape? The controller manually throws `new HttpException({error:{...}}, 400)`? Simpler: the controller throws a DomainException('validation_error', 400) directly — it's a domain error with an HTTP status, and the filter handles both uniformly.

For unexpected errors: log it? `console.error` or Logger. Use Nest's Logger. details: {} (never leak). 500.

## Controller

```ts
@Controller('documents')
export class AnchoringController {
  constructor(private readonly anchoring: AnchoringService) {}

  @Post(':documentId/versions')
  createVersion(@Param('documentId') documentId, @Body() body) {
    validate documentId is a string; body.version is an int >= 1; body.content is a non-null object
    return this.anchoring.createVersion(documentId, version, content);
  }

  @Post(':documentId/versions/:version/anchors')
  anchor(@Param() ... ) {
    validate documentId, version
    return this.anchoring.anchorDocument(documentId, version);
  }

  @Post(':documentId/versions/:version/anchors/verifications')
  verify(@Param, @Body() body) {
    validate; body.content is an object
    return this.anchoring.verify(documentId, version, body.content);
  }
}
```

Route paths: `documents/:documentId/versions` (plural), `documents/:documentId/versions/:version/anchors`, `.../anchors/verifications`. Kebab-case: single-word segments; kebab applies to multi-word — none here. Plural: versions, anchors, verifications, documents.

The `version` param is a string in the route — validate int.

Response shapes:

createVersion → 201 `{ documentId, version, contentHash? }` — let me return the version row: `{ documentId, version, id, createdAt }`? Keep: `{ documentId, version }`. The service returns `{ documentId, version, id }`.

anchor → 201 `{ anchor: AnchorDto }` or flat: `{ documentId, version, status, txId, signedTx? no — don't return signedTx (secrets? no real keys; but no need to return it), blockNumber, contentHash, id, updatedAt }`. Let me define the DTO:
```
{ id, documentId, version, status, contentHash, txId, blockNumber: number|null, createdAt, updatedAt }
```

verify → 200:
```
{ documentId, version, match: boolean, status, proof: { txId, blockNumber, blockHash } | null, differences: Array<{ path, kind, stored?, supplied? }> }
```
- match true + confirmed: proof set, differences [].
- match true + pending: proof null (or a txId-only proof?). "The anchor proof (txId, block)" — the block requires a receipt. If pending: return `proof: null` + status 'broadcast_sent' etc., and a `pending: true` flag? Let me include the status field so the caller understands. Or `proof: { txId, blockNumber: null }`? A proof without a block isn't a proof. Let me do: match true, status from the anchor, proof = confirmed ? {txId, blockNumber, blockHash} : null, and also expose txId at the top level? The anchor's txId is in the response either way: `txId` field + `proof`. Let me finalize the verify response:

```
{
  documentId, version,
  contentHashStored, contentHashSupplied,
  match,
  anchorStatus,             // 'confirmed' | 'pending' | 'failed'
  proof: { txId, blockNumber, blockHash } | null,
  differences: [ { path, kind, stored, supplied } ]  // empty when match
}
```
The pending status string: map non-confirmed/non-failed to 'pending' (keep the actual status too? add `anchorState` raw?). Let me keep both: `anchorState: 'confirmed'` raw enum value and the simplified `match`. Hmm, simpler: `anchorState` (the actual state string, snake) + `proof` + `match` + `differences`. If the state is failed → match is false? A failed anchor with matching content: the content matches what we tried to anchor, but the anchoring failed — the report should say the anchoring failed (no proof). Let me set: match = hash match; proof = confirmed only; anchorState conveys the failure. Good — "a mismatch report stating what differs" is for the hash mismatch case; a failed anchor is a different report kind. Acceptable.

difference kind: `value`, `missing_in_supplied`, `missing_in_stored`. Paths: root is `'$'`, children are `$.a.b[0].c`. The diff is bounded (the entire tree) — fine for report sizes.

Diff algorithm:

```ts
function diff(stored, supplied, path, out) {
  if (isPlainObject(stored) && isPlainObject(supplied)) {
    for key in union: if both → recurse; if only stored → out.push({path: path.key, kind:'missing_in_supplied', stored: value}); if only supplied → missing_in_stored.
  } else if (arrays) {
    compare lengths: recurse to min; extra indices → kind index missing.
  } else {
    if (!looseEqual(stored, supplied)) out.push({path, kind:'value', stored, supplied});
  }
}
```
looseEqual: JSON deep equality of primitives (numbers via Object.is? 1 vs 1.0 are the same after JSON parsing). Use `JSON.stringify`? Use `==`? For numbers/strings/booleans/null: `stored === supplied` but for -0 vs 0... use `Object.is`, with a fallback `stored == supplied`? Let me use: `!Object.is(stored, supplied) && stored !== supplied` → hmm -0: Object.is(-0,0)=false but they're equal in JSON semantics (both canonicalize to "0"). Since both came from JSON parsing, -0 → JSON.parse returns -0! JSON.parse('-0') → -0. Ugh. But canonicalize(-0) = "0" (JSON.stringify(-0)="0"), so two contents "-0" vs "0" have the same hash → match; the diff is only shown when the hashes differ, and -0 vs 0 has the same hash → no diff. The diff is only computed when the hashes differ, so -0/0 wouldn't surface anyway (well, could be part of a larger structure with other diffs — then -0 vs 0 at a path: the diff says value mismatch when the hash says... fine, edge, use `Object.is` with a Number check: treat numbers equal if `stored === supplied` (which covers -0==0). Let me use `===` for primitives.)

## Canonicalization doc

`docs/canonicalization.md` — write it down:

```md
# Canonicalization of report content

The structured JSON is the source of truth; the PDF is a rendering and is never hashed.

Algorithm (SHA-256 of the canonical UTF-8 bytes):

1. Input: the parsed JSON value (object) of the stored report version.
2. Serialize recursively:
   - object: keys sorted lexicographically by UTF-16 code unit order (JS default sort); emit `{"k1":v1,"k2":v2}`; keys with an `undefined` value are omitted (JSON.stringify semantics); duplicate keys are impossible after JSON.parse.
   - array: order preserved; `["a","b"]`.
   - string: JSON.stringify escaping (UTF-16 escapes for non-BMP as \uXXXX pairs per JSON.stringify).
   - number: the shortest decimal representation that round-trips to the same IEEE-754 double — exactly what JSON.stringify emits (`1.5`, `100`, `1e+21`); non-finite (NaN/Infinity) is rejected — content must be JSON-parsable.
   - boolean/null: the literals `true`/`false`/`null`.
   - no whitespace between tokens.
3. Encode the resulting string as UTF-8.
4. Hash: SHA-256; store/transmit as 64 lowercase hex characters.

Examples:
- `{b:1, a:{d:2,c:[true,null]}}` → `{"a":{"c":[true,null],"d":2},"b":1}` → sha256.
- Numbers: `1.10` and `1.1` canonicalize identically; `100` and `1e2` differ ("100" vs "100"? — wait JSON.stringify(1e2) = "100". Hmm! 1e2 parses to the number 100 → stringify "100". So they're identical. And 1e21 → "1e+21" (stringify uses exponent above 1e21). Let me pick the right examples: `0.5` and `0.50` → both "0.5". `100` vs `1e2` → both "100". A distinguishing example: `1234567891011121314` stays as-is; a float `1.234567890123456789` → shortest round-trip "1.2345678901234568". Let me keep the examples simple.

Reproduction: any auditor computes it as: parse JSON → the canonical serialize above → UTF-8 → SHA-256 hex. The code reference: src/anchoring/canonicalize.ts.
```

Also state what's not covered: the PDF bytes, the key insertion order, formatting whitespace are all irrelevant.

## main.ts / app.module.ts

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

app.module:
```ts
@Module({ imports: [AnchoringModule] })
export class AppModule {}
```

## anchoring.module.ts

```ts
@Module({
  imports: [PrismaModule],
  controllers: [AnchoringController],
  providers: [
    AnchoringService,
    AnchoringRepository,
    AnchoringWorker,
    { provide: CHAIN_CLIENT, useFactory: () => new InMemoryChainClient(), inject: [] },
  ],
  exports: [AnchoringService],
})
export class AnchoringModule {}
```

// ASSUMPTION: no real L2 chain client is in scope ("no real keys, no RPC"), so the in-process InMemoryChainClient is the default CHAIN_CLIENT provider; deployment replaces this provider with a real client.

## The service in detail

```ts
export interface AnchoringConfig { broadcastTimeoutMs: number; }

@Injectable()
export class AnchoringService implements OnApplicationBootstrap? No — the worker handles scheduling.
```

The service:

```ts
@Injectable()
export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    private readonly config: { broadcastTimeoutMs: number },
  ) {}
```

Hmm — the config as a DI token: `ANCHORING_CONFIG` provided by the module from env. In the direct-construction test, I pass the object. OK: `@Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig`.

Config interface:
```ts
export interface AnchoringConfig {
  broadcastTimeoutMs: number;
  confirmationPollMs: number;
  recoverySweepMs: number;
  stuckAfterMs: number;
}
```
Env: BROADCAST_TIMEOUT_MS, ANCHORING_CONFIRMATION_POLL_MS, ANCHORING_RECOVERY_SWEEP_MS, ANCHORING_STUCK_AFTER_MS. Defaults: 30000, 5000, 60000, 60000.

`createVersion(documentId, version, content)`:
```
Validate content is a plain object (or an array? report = object; require a non-null object that's not an array)
canonicalize(content) must succeed (throw invalid_anchor_content on failure)
try repo.createVersion → on P2002 → version_conflict (409, 'document_version_conflict')
return the row
```

`anchorDocument(documentId, version)`:
```
const dv = await repo.findVersion(documentId, version) ?? throw documentVersionNotFound
let contentHash: string;
try { contentHash = canonicalHash(dv.content); } catch { throw invalid_anchor_content }
const prepared = this.chain.prepare({ documentId, version, contentHash });  // local, deterministic
const anchor = await repo.createAnchor({ documentId, version, contentHash, txId: prepared.txId, signedTx: prepared.signedTx, status: PREPARED });
   // the write-ahead commit happens inside createAnchor (a single insert, autocommit)
const outcome = await this.attemptBroadcast(anchor.signedTx);
if (outcome === 'sent') {
  await repo.transition(anchor.id, [PREPARED], BROADCAST_SENT, { broadcastAttempts: a => +1 });
} else {
  await repo.transition(anchor.id, [PREPARED], BROADCAST_UNKNOWN, {...});
}
const fresh = await repo.findById(anchor.id);
return fresh;
```

attemptBroadcast:
```ts
private async attemptBroadcast(signedTx: string): Promise<'sent' | 'unknown'> {
  try {
    await Promise.race([
      Promise.resolve(this.chain.broadcast(signedTx)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new BroadcastTimeout()), this.config.broadcastTimeoutMs)),
    ]);
    return 'sent';
  } catch {
    return 'unknown';
  }
}
```
Note: an unhandled promise that's still pending after the timeout — if it later rejects, the unhandledrejection warning? In Node, a rejected promise that's part of a race with no handler → unhandledRejection. To be safe: attach a no-op catch to the raw promise:
```ts
const p = Promise.resolve(this.chain.broadcast(signedTx));
p.catch(() => {}); // avoid unhandled rejection if the timeout wins
```
Good detail.

`verify(documentId, version, supplied)`:
```
const dv = await repo.findVersion(documentId, version) ?? throw documentVersionNotFound
let suppliedHash; try canonicalize catch → invalid_anchor_content
const anchor = await repo.findAnchor(documentId, version) ?? throw anchorNotFound
const match = suppliedHash === anchor.contentHash
let differences = [];
if (!match) differences = diffJson(dv.content, supplied);
const confirmed = anchor.status === 'confirmed';
return {
  documentId, version,
  storedContentHash: anchor.contentHash,
  suppliedContentHash: suppliedHash,
  match,
  anchorState: anchor.status,
  proof: confirmed ? { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.receipt?.blockHash } : null,
  differences,
};
```

## Worker

```ts
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  constructor(repo, @Inject(CHAIN_CLIENT) chain, @Inject(ANCHORING_CONFIG) config) {}
  onApplicationBootstrap() {
    if (this.config.confirmationPollMs > 0) this.timers.push(setInterval(() => void this.runConfirmationPass(), ms));
    if (this.config.recoverySweepMs > 0) this.timers.push(setInterval(() => void this.runRecoveryPass(), ms));
  }
  onModuleDestroy() { for (t of this.timers) clearInterval(t); }

  async runConfirmationPass() {
    const rows = await repo.listByStatuses(['broadcast_sent'], 100);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      if (receipt.status === 'success') await repo.transition(row.id, ['broadcast_sent'], 'confirmed', { blockNumber: receipt.blockNumber, receipt });
      else await repo.transition(row.id, ['broadcast_sent'], 'failed', { blockNumber: receipt.blockNumber, receipt });
    }
  }

  async runRecoveryPass() {
    const stuckBefore = Date.now() - this.config.stuckAfterMs;
    const rows = await repo.listStuck(['prepared','broadcast_unknown'], stuckBefore, 100);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);   // chain first
      if (receipt) { confirm or fail via CAS from ['prepared','broadcast_unknown'] }
      else {
        const outcome = await this.attemptBroadcast(row.signedTx); // the same signed tx
        const to = outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown';
        await repo.transition(row.id, ['prepared','broadcast_unknown'], to, {broadcastAttempts+1});
      }
    }
  }
}
```

The transition data for attempts: the repository transition with a function? Prisma updateMany can't increment conditionally with a function... it can: `data: { broadcastAttempts: { increment: 1 } }` works in updateMany. So the repository method signature: `transition(id, from[], to, data?: { blockNumber?, receipt? , incrementAttempts?: boolean })` → build the prisma data with increment. Let me pass a full prisma-style partial: `transition(id, from, to, extra?: { blockNumber?: number; receipt?: unknown; incrementBroadcastAttempts?: boolean })`. The repository maps to the Prisma payload. Good — the service/worker don't touch Prisma types.

receipt stored as Json: store `{ blockNumber, blockHash, status }`.

listStuck: `where: { status: {in}, updatedAt: { lt: stuckBefore } }, orderBy updatedAt asc, take: limit`.

Edge: a row in `prepared` stuck for >60s (process died before broadcast) → the sweep broadcasts. Good.

Concurrency: the service's own anchorDocument does create→broadcast within milliseconds; the sweep's stuckAfter 60s prevents racing with in-flight ones. Multiple worker instances: the CAS transition prevents double-confirm; double re-broadcast: two sweeps might both re-broadcast the same signedTx — the chain deduplicates (same txId) → still one anchor. Acceptable; noted in a comment.

## The repository in detail

```ts
@Injectable()
export class AnchoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(documentId, version, content): Promise<{id, documentId, version}> {
    try {
      const doc = await this.prisma.document.upsert({ where: { id: documentId }, update: {}, create: { id: documentId } });
      const v = await this.prisma.documentVersion.create({ data: { documentId, version, content: content as Prisma.InputJsonValue } });
      return {...};
    } catch (e) { if (isUniqueViolation(e)) throw new DomainException('document_version_conflict', ...409...); throw e; }
  }
```

Hmm — document upsert + version create in a transaction for atomicity: `this.prisma.$transaction([docUpsert, versionCreate])`? A transaction with data-dependent... both independent: upsert document by id (no return needed), then create version. Use an interactive transaction:
```ts
await this.prisma.$transaction(async (tx) => {
  await tx.document.upsert(...);
  await tx.documentVersion.create(...);
});
return await this.findVersion(documentId, version)!;
```
`$transaction` — is that a "Prisma client call" from the repository? Yes, allowed (repository touches the DB).

Wait — do I even need a Document parent row? For FK integrity, yes if document_versions.document_id references documents.id. Do I want that FK? It enforces referential integrity — good, but also means the anchor's documentId should reference documents too? Anchor has document_id + version. I could FK the anchor to document_versions (composite) — Prisma supports composite references: `@relation(fields: [documentId, version], references: [documentId, version])` requires a unique constraint on the referenced pair — which we have. That's elegant: the anchor can only exist for an issued version. But it adds coupling: deleting a version cascades the anchor... Let me keep it simple: no FK from anchor to version (the anchor is an audit record that outlives the version row? versions aren't deleted in this system). Decision: documents table (PK id), document_versions (FK to document, unique(documentId,version)), anchors (standalone, unique(documentId, version), no FK). Simple, and the required uniqueness is present. The anchor's documentId has no FK — acceptable; the anchor row is written only via anchorDocument which verifies the version's existence.

Hmm, but "exactly one anchor per (document, version), enforced at the schema level" — `@@unique([documentId, version])` on anchors. Yes.

findVersion: `this.prisma.documentVersion.findUnique({ where: { documentId_version: { documentId, version } } })`.

createAnchor:
```ts
try {
  return await this.prisma.anchor.create({ data: {...} });
} catch (e) {
  if (isUniqueViolation(e)) throw new DomainException('anchor_conflict', `an anchor already exists for document ${documentId} version ${version}`, 409, { documentId, version });
  throw e;
}
```
isUniqueViolation: `e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'`. The repository imports Prisma — fine (the repository touches the DB layer).

findAnchor: findUnique by documentId_version.
findById: findUnique by id.
listByStatuses(statuses, limit): findMany.
listStuck(statuses, before, limit): findMany where status in, updatedAt < before.
transition:
```ts
async transition(id, from, to, extra?): Promise<boolean> {
  const data: any = { status: to };
  if (extra?.blockNumber !== undefined) data.blockNumber = extra.blockNumber;
  if (extra?.receipt !== undefined) data.receipt = extra.receipt;
  if (extra?.incrementBroadcastAttempts) data.broadcastAttempts = { increment: 1 };
  const res = await this.prisma.anchor.updateMany({ where: { id, status: { in: from } }, data });
  return res.count > 0;
}
```

Types: the repository returns plain DTO types (not Prisma model types) to keep the layer clean? Using Prisma-generated types for the input is fine (they're types, not client calls). But "zero Prisma client calls" for the service — the service doesn't import prisma. The repository returns typed objects. Let me define plain interfaces in the repository file: `StoredVersion { id, documentId, version, content: unknown }`, `StoredAnchor { id, documentId, version, status: AnchorState, contentHash, txId, signedTx, blockNumber: number|null, receipt: ReceiptRecord|null, broadcastAttempts, createdAt, updatedAt }`. The repository maps from the prisma row. AnchorState = 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed' — the TS string union mirrors the enum mapping. Prisma's enum value: AnchorStatus.BROADCAST_SENT maps to 'broadcast_sent'. The repository converts: `row.status === Prisma enum` → to a string via the map, or define `const STATUS_DB_TO_STATE: Record<AnchorStatus, AnchorState>`. Or even simpler: don't use a Prisma enum at all — a String column + a TS union + a DB CHECK constraint? A Prisma enum is cleaner and self-documenting; the conversion is trivial. Actually — Prisma enum values in TS: `Prisma.AnchorStatus.BROADCAST_SENT`... the generated TS enum name = the field name as-is (BROADCAST_SENT). And the DB value 'broadcast_sent' via @map. The repository: `state: row.status as AnchorState`? The TS enum's *value* is 'BROADCAST_SENT' (TS-level), not the mapped DB value! Right — the @map on enum values affects only the DB; the TS side stays BROADCAST_SENT. So the repository must convert: `toState(row.status)` via an explicit map. Fine, a small const.

Or skip the Prisma enum and use a String column with a TS union — avoids the map confusion. The DB-level enum type is nice (prevents junk values) and the migration shows a proper enum. Let me keep the Prisma enum + the explicit conversion map. Actually hmm, wait: does Prisma generate TS enums for mapped enums correctly? Yes.

Or even simpler: keep the enum values in Prisma as SCREAMING_SNAKE with no @map (DB values 'BROADCAST_SENT') — but the convention: column values... the convention says tables/columns are snake_case; enum *values* aren't strictly column names. But the snake_case DB value is consistent with the "details/envelope" vibe. Let me use @map to snake. With the conversion map. OK.

## The chain client types

```ts
// chain-client.ts
export interface ChainTxInput { documentId: string; version: number; contentHash: string; }
export interface PreparedTx { txId: string; signedTx: string; }
export interface ChainReceipt { txId: string; blockNumber: number; blockHash: string; status: 'success' | 'failure'; }
export interface ChainClient {
  prepare(tx: ChainTxInput): PreparedTx;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
export const CHAIN_CLIENT = Symbol? 'CHAIN_CLIENT'
```

The token: `export const CHAIN_CLIENT = 'CHAIN_CLIENT';` a string token (ESM-friendly).

InMemoryChainClient + a shared InMemoryChainState:

```ts
// in-memory-chain-client.ts
interface LandedTx { receipt: ChainReceipt; }
export class InMemoryChainState {
  readonly receipts = new Map<string, ChainReceipt>();
  readonly broadcastLog: string[] = [];  // every signedTx accepted
  private nextBlock = 1;
  land(txId: string, status: 'success'|'failure' = 'success') { if (!this.receipts.has(txId)) this.receipts.set(txId, { txId, blockNumber: this.nextBlock++, blockHash: 'blk_' + txId.slice(1, 9), status }); }
}
export class InMemoryChainClient implements ChainClient {
  constructor(private readonly state: InMemoryChainState = new InMemoryChainState()) {}
  private txIds = new Map<string, string>(); // signedTx -> txId
  prepare(tx: ChainTxInput): PreparedTx {
    const txId = 'tx_' + sha256hex(JSON.stringify(tx)).slice(0, 40);
    const signedTx = `signed:${txId}`;
    this.txIds.set(signedTx, txId);
    return { txId, signedTx };
  }
  async broadcast(signedTx: string) {
    const txId = this.txIds.get(signedTx) ?? `tx_unknown_${...}`; // a real chain might accept an unknown tx? in our flow it's always prepared first.
    this.state.broadcastLog.push(signedTx);
    this.defaultBroadcast?.(signedTx, txId) ?? this.state.land(txId);
  }
  async getReceipt(txId: string) { return this.state.receipts.get(txId) ?? null; }
  // test hooks:
  setBroadcast(fn: ((signedTx: string, txId: string) => Promise<void>) | null) { this.defaultBroadcast = fn; }
}
```

Hmm, the hook semantics: `setBroadcast(null)` → default (land + resolve). Let me restructure: `broadcastBehavior?: (signedTx, txId, state) => Promise<void>`; default behavior = state.land(txId). The test overrides it:

- hang + land: `client.setBroadcast(async (st, txId, state) => { state.land(txId); await new Promise(() => {}); })`
- crash: `client.setBroadcast((st, txId, state) => { state.land(txId); throw new Error('simulated process crash after chain acceptance'); })`
- hang, no land: `client.setBroadcast(() => new Promise(() => {}))`
- normal: `client.setBroadcast(null)`

But wait — "never assert only that calls happened" — the broadcastLog is for asserting "the same signed tx was re-broadcast" and "no re-broadcast" — that's a meaningful behavior assertion (idempotency of the resend), tied to the chain state. Fine.

Also, the default broadcast in the real app (non-test) lands immediately → the worker confirms on the next poll. The app works end-to-end with the in-memory chain.

sha256 for the txId: use node crypto in the fake — fine.

## canonicalize.ts

```ts
import { createHash } from 'node:crypto';
// documented canonicalization (see docs/canonicalization.md)
export function canonicalize(value: unknown): string { ... }
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
export function diffJson(stored: unknown, supplied: unknown): Difference[] { ... }
```

Where to put diff? Also in canonicalize.ts, or a separate `content-diff.ts`? Let me keep both in `canonicalize.ts` (the canonical content utility) — or split: `canonicalize.ts` (serialize + hash) and `content-diff.ts` (diff). Two files, both in src/anchoring/. The naming rule kebab-case.role.ts is for feature role files; utilities are fine. Let me use `src/anchoring/canonicalize.ts` and `src/anchoring/content-diff.ts`.

The diff's types:
```ts
export interface ContentDifference {
  path: string;
  kind: 'value' | 'missing_in_supplied' | 'missing_in_stored';
  stored?: unknown;
  supplied?: unknown;
}
```
For missing_in_supplied: only stored is present. For value: both. JSON serialization drops undefined — the response JSON will omit the missing side. Good.

Diff path: root '$'; an object key: `${path}.${key}` (escape? keys with dots — ignore, fine); an array index: `${path}[${i}]`.

Object comparison: only both plain objects (not arrays, not null) → key union. Both arrays → length: recurse to min, then extra indices → missing_in_* at path[i]. Mixed types → a value difference (unless both are equal). Primitive equality via `===`, plus handling -0? `Object.is` vs `===`: let me use `stored === supplied ? equal : diff` — -0 === 0 is true → equal. Good.

But wait: numbers from JSON are fine; what if the supplied content has a nested array where the stored has an object → a value kind at the same path. OK.

## The exception filter

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const { status, body } = this.describe(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json(body);
  }
  private describe(exception: unknown): { status: number; body: ErrorEnvelope } {
    if (exception instanceof DomainException) return { status: exception.httpStatus, body: { error: { code: exception.code, message: exception.message, details: exception.details } } };
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      // if it's already in our shape, pass through
      if (typeof res === 'object' && res !== null && 'error' in (res as any) && (res as any).error?.code) return { status, body: res as ErrorEnvelope };
      const code = status === 400 ? 'validation_error' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'http_error';
      const message = typeof res === 'string' ? res : 'request failed';
      return { status, body: { error: { code, message, details: {} } } };
    }
    return { status: 500, body: { error: { code: 'internal_error', message: 'internal server error', details: {} } } };
  }
}
```

The Express response's `.json`/`.status` — typing: use any-ish with a guard. In TS strict, `res` from getResponse() is `any`? `ctx.getResponse()` returns any (the Express Response). OK.

DomainException:
```ts
export class DomainException extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus: number, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainException';
  }
}
export function domainException(code, message, status, details?) — let me use factory helpers:
export const documentVersionNotFoundError = (documentId: string, version: number) => new DomainException('document_version_not_found', `document version ${documentId}#${version} was not issued`, 404, { documentId, version });
export const anchorNotFoundError = (documentId, version) => new DomainException('anchor_not_found', `no anchor exists for document ${documentId} version ${version}`, 404, { documentId, version });
export const anchorConflictError = (documentId, version) => new DomainException('anchor_conflict', `an anchor already exists for document ${documentId} version ${version}`, 409, { documentId, version });
export const documentVersionConflictError = (documentId, version) => new DomainException('document_version_conflict', `document ${documentId} version ${version} was already issued`, 409, { documentId, version });
export const invalidAnchorContentError = (reason: string) => new DomainException('invalid_anchor_content', `report content cannot be canonically hashed: ${reason}`, 422, { reason });
```

## The controller validation

```ts
private assertDocumentId(documentId: string): string {
  if (typeof documentId !== 'string' || !documentId.trim()) throw new DomainException('validation_error', 'documentId must be a non-empty string', 400, { documentId });
  return documentId;
}
private assertVersion(raw: string): number {
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) throw new DomainException('validation_error', 'version must be a positive integer', 400, { raw });
  return version;
}
private assertContent(content: unknown): Record<string, unknown> {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) throw new DomainException('validation_error', 'content must be a JSON object', 400, {});
  return content as Record<string, unknown>;
}
```

The controller returns the service result; the status: default 201 for POST. anchor → the service returns the anchor state; let me have the controller return 201. verify → 200 (explicit @HttpCode(200)).

Now — the anchor endpoint when the outcome is unknown: 201 with the state broadcast_unknown. OK.

## Migration SQL

`prisma/migrations/20250101000000_init/migration.sql`:

```sql
-- Create Enum
CREATE TYPE "AnchorStatus" AS ENUM ('prepared', 'broadcast_sent', 'broadcast_unknown', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'prepared',
    "block_number" INTEGER,
    "receipt" JSONB,
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

The id is uuid(): I wrote `@default(uuid())` → in the SQL, `UUID NOT NULL DEFAULT gen_random_uuid()`? Prisma generates `"id" TEXT NOT NULL DEFAULT uuid()` for postgres? Hmm: for `String @id @default(uuid())` on postgres, Prisma creates `"id" TEXT NOT NULL DEFAULT uuid()`. Wait, no — Prisma maps uuid() to the `uuid()` function, and the column type is TEXT? Let me recall the actual Prisma migration output for `id String @id @default(uuid())` on PostgreSQL:

```sql
CREATE TABLE "User" (
    "id" TEXT NOT NULL DEFAULT uuid(),
    ...
);
```
Yes — Prisma uses TEXT + DEFAULT uuid() for String uuid defaults (not the native uuid type). The uuid() function exists in Postgres (pgcrypto? no — `uuid()` is built-in in Postgres 13+; in earlier versions, uuid-ossp). Prisma's generated SQL uses `DEFAULT uuid()`. Since I'm hand-writing the migration to match what Prisma would generate, let me use `"id" TEXT NOT NULL DEFAULT uuid()`. To be safe across versions, Prisma itself generates exactly that; I'll mirror it.

`@@map` etc. all line up.

`migration_lock.toml`:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git or svn)
provider = "postgresql"
```

## Schema.prisma final

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Document {
  id        String   @id @map("id")
  createdAt DateTime @default(now()) @map("created_at")
  versions  DocumentVersion[]

  @@map("documents")
}

model DocumentVersion {
  id         String   @id @default(uuid()) @map("id")
  documentId String   @map("document_id")
  version    Int
  content    Json
  createdAt  DateTime @default(now()) @map("created_at")
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, version])
  @@map("document_versions")
}

enum AnchorStatus {
  PREPARED          @map("prepared")
  BROADCAST_SENT    @map("broadcast_sent")
  BROADCAST_UNKNOWN @map("broadcast_unknown")
  CONFIRMED         @map("confirmed")
  FAILED            @map("failed")

  @@map("AnchorStatus")
}

model Anchor {
  id                String       @id @default(uuid()) @map("id")
  documentId        String       @map("document_id")
  version           Int
  contentHash       String       @map("content_hash")
  txId              String       @map("tx_id")
  signedTx          String       @map("signed_tx")
  status            AnchorStatus @default(PREPARED) @map("status")
  blockNumber       Int?         @map("block_number")
  receipt           Json?        @map("receipt")
  broadcastAttempts Int          @default(0) @map("broadcast_attempts")
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")

  @@unique([documentId, version])
  @@map("anchors")
}
```

onDelete Cascade on the document→version relation: if a document is deleted, versions are deleted too; the anchors remain (no FK) — acceptable, the audit trail persists. The migration: ON DELETE CASCADE ON UPDATE CASCADE. Let me update the migration accordingly.

Wait — does the Document model need a `createdAt`? Harmless, minimal. Keep it minimal: just id + versions? The convention doesn't forbid it. Keep `createdAt`? "Do exactly what the task asks" — a minimal Document with only id. Let me drop the createdAt from Document. Keep the versions relation.

## package.json?

Hmm — should I include a package.json, tsconfig, vitest.config? The task says "build the complete solution in one reply... deliver all the files the solution needs, complete, from the first line to the last." The environment convention mentions pnpm, vitest, ESM type: module. The repo presumably exists with those? "If a file is given above the task, that's the existing codebase" — no file was given! So I need to create the repo from scratch → I should include package.json, tsconfig.json, vitest.config.ts to be complete. The format parser only reads the file blocks; including the config files is "all the files the solution needs." Yes, let me include:

- package.json (scripts: build, start, test, prisma migrate; deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @prisma/client, reflect-metadata, rxjs; dev: @nestjs/testing? (for the API test), prisma, typescript, vitest, tsx? ts-node? For running: `node dist/main.js` after tsc, or tsx. Keep: build with tsc, start with node dist/main.js. vitest for tests (which can run TS directly, no ts-node needed).
  - ESM: `"type": "module"`. NestJS + ESM: Nest supports ESM with caveats (works on Nest 10+ with `module: "nodenext"`/ES2022). tsconfig: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"strict": true`, `"experimentalDecorators": true`, `"emitDecoratorMetadata": true`. ESM + Nest: does `import 'reflect-metadata'` need to be at the top of main? In ESM, reflect-metadata is imported by @nestjs/core itself. Known gotcha: Nest ESM requires `"module": "nodenext"` and relative imports with `.js` extension?? With NodeNext, TS requires explicit `.js` extensions on relative imports. That's painful but correct. Many Nest ESM setups use `"module": "ESNext"` + `"moduleResolution": "Bundler"`... but then runtime node ESM requires extensions. Hmm.

  The convention says ESM, `"type": "module"`. To make it actually runnable: tsconfig module NodeNext, and all relative imports use `.js` extensions. Let me do that consistently (import './app.module.js'). Vitest handles TS ESM fine (its loader resolves .ts? with `module: NodeNext`, the relative imports in the source say `./x.js`; the source file is `x.ts` — the TS compiler maps x.js → x.ts. Vitest/vite also resolves `./x.js` → `x.ts`? Vite supports TS ESM style imports (resolving .js to .ts) — yes, Vite has supported that since ~3 (for TS files). Vitest is Vite-based → works.

  Alternatively, to reduce the risk of import-extension pitfalls in this eval (which won't run), I could use `module: "ESNext"`, `moduleResolution: "Bundler"` with extension-less imports — cleaner code, and Vite/vitest is happy; but `tsc` output for node would be extension-less → node ESM would fail at runtime. Since the eval likely checks code quality more than runtime, but "correctness" matters — let me go with NodeNext + .js extensions. That's the defensible, runnable configuration. Let me be careful that every relative import has a .js extension.

  Hmm, wait — Prisma + ESM: `@prisma/client` has a proper ESM export (a default + named). `import { PrismaClient, Prisma } from '@prisma/client'` works in ESM. Good.

- tsconfig.json
- vitest.config.ts:
  ```ts
  import { defineConfig } from 'vitest/config';
  export default defineConfig({ test: { environment: 'node', include: ['test/**/*.spec.ts'], testTimeout: 30000, hookTimeout: 30000 } });
  ```
- .env? No — "no secrets in the repo"; DATABASE_URL from the environment. I can add `.env.example`? That's a new file not requested... but it's standard for "config from environment." A small `.env.example` with `DATABASE_URL=postgres://...` and `PORT=3000` — is it requested? The env convention is satisfied without it. Discipline: don't create files not requested by the task. Let me skip .env.example. Hmm, it's genuinely useful, but... the discipline is explicit. Skip.

package.json deps (with reasonable versions):
```json
{
  "name": "report-anchoring",
  "type": "module",
  "scripts": {
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx src/main.ts",
    "prisma:migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.14.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.0",
    "prisma": "^5.14.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

tsx for dev run (ESM-friendly). Good.

## Now the test file — the heart. Let me write it carefully.

`test/anchoring.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnchoringRepository } from '../src/anchoring/anchoring.repository.js';
import { AnchoringService } from '../src/anchoring/anchoring.service.js';
import { AnchoringWorker } from '../src/anchoring/anchoring.worker.js';
import { InMemoryChainClient, InMemoryChainState } from '../src/anchoring/in-memory-chain-client.js';
import { canonicalHash } from '../src/anchoring/canonicalize.js';
import { DomainException } from '../src/common/exceptions.js';
```

Wait — ESM: the test imports src with the .js extension. The vitest resolves it. OK.

Setup:
```ts
const prisma = new PrismaService();
let repo: AnchoringRepository;
let chainState: InMemoryChainState;
let chain: InMemoryChainClient;
let service: AnchoringService;
let worker: AnchoringWorker;
const config = { broadcastTimeoutMs: 100, confirmationPollMs: 0, recoverySweepMs: 0, stuckAfterMs: 0 };
```

Hmm — PrismaService without Nest: `new PrismaService()` — the constructor of PrismaClient is fine. `await prisma.$connect()` in beforeAll. In afterAll, `await prisma.$disconnect()`.

beforeEach: clean the table:
```ts
await prisma.anchor.deleteMany();
await prisma.documentVersion.deleteMany();
await prisma.document.deleteMany();
```
(The order respects the FK; anchors first, no FK anyway.)

Helper to make a new "process":
```ts
function makeProcess() {
  const chain = new InMemoryChainClient(chainState);
  const service = new AnchoringService(repo, chain, config);
  const worker = new AnchoringWorker(repo, chain, config);
  return { chain, service, worker };
}
```
The worker with pollMs 0 → no interval (my design: skip scheduling when ms <= 0).

Helper:
```ts
async function issueVersion(documentId: string, version: number, content: Record<string, unknown>) {
  return service.createVersion(documentId, version, content);
}
```
Using a fresh service per test.

Now the tests:

**1. write-ahead:**
```ts
it('commits the anchor intent with the tx identity before the broadcast returns', async () => {
  const content = { patient: 'anon-42', result: 'positive', score: 1.5 };
  await issue('doc-wa', 1, content);
  let release!: () => void;
  chain.setBroadcast(async (signedTx, txId, state) => {
    state.land(txId);
    await new Promise<void>(res => { release = res; });
  });
  const anchorPromise = service.anchorDocument('doc-wa', 1);
  // Wait for the write-ahead row to appear while the broadcast is still in flight
  const row = await waitForRow('doc-wa', 1);
  expect(row.status).toBe('prepared');
  expect(row.txId).toBeTruthy();
  expect(row.signedTx).toBe(`signed:${row.txId}`);
  release();
  const anchor = await anchorPromise;
  expect(anchor.status).toBe('broadcast_sent');
  // and the on-chain tx is the one we persisted
  const receipt = await chain.getReceipt(row.txId);
  expect(receipt?.txId).toBe(row.txId);
});
```

waitForRow: a poll loop:
```ts
async function waitForRow(documentId: string, version: number, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await repo.findAnchor(documentId, version);
    if (row) return row;
    if (Date.now() > deadline) throw new Error('anchor row did not appear');
    await sleep(10);
  }
}
```

This behaviorally proves the ordering: the row with a txId exists while the broadcast is still unresolved.

**2. timeout landed → confirm, no re-broadcast:**
```ts
it('broadcast timeout that landed: recovery confirms from the receipt and never re-broadcasts', async () => {
  await issue('doc-to', 3, { a: 1 });
  chain.setBroadcast(async (signedTx, txId, state) => { state.land(txId); await new Promise(() => {}); }); // hang forever
  const anchor = await service.anchorDocument('doc-to', 3);
  expect(anchor.status).toBe('broadcast_unknown');
  expect(anchor.txId).toBeTruthy();
  const broadcastsBefore = chain.state.broadcastLog.length; // 1
  await worker.runRecoveryPass(); // chain first: receipt exists
  const after = await repo.findAnchor('doc-to', 3)!;
  expect(after.status).toBe('confirmed');
  expect(after.blockNumber).toBeTypeOf('number');
  expect(chain.state.broadcastLog.length).toBe(broadcastsBefore); // no re-broadcast
  expect(await prisma.anchor.count({ where: { documentId: 'doc-to', version: 3 } })).toBe(1);
});
```

Wait: the hanging promise — the service's attemptBroadcast: race(broadcastPromise, timeout 100ms) → the timeout wins → unknown. The broadcast promise is still pending forever (leaked, but the test is fine; the unhandled? the promise that never settles → no unhandledrejection. OK.)

The worker's runRecoveryPass: stuckAfter 0 → the row's updatedAt < now → included (the row is a few ms old; `updatedAt: { lt: new Date(Date.now() - 0) }` — now-0 = now; the row's updatedAt <= now → included. Edge: same-millisecond equality — lt is strict; if updatedAt is exactly now (unlikely, ms precision, and there's a delay) fine. Let me make the where `lte`? A stuckAfter 0 with `lt: new Date()` — the row's updatedAt is set at create time, and there's definitely >0 ms elapsed by the time of the sweep. OK.

**3. timeout not landed → re-broadcast the same signed tx:**
```ts
it('broadcast timeout that did not land: the same signed tx is re-broadcast and one anchor results', async () => {
  await issue('doc-nl', 1, { a: 1 });
  chain.setBroadcast(() => new Promise(() => {})); // hang, nothing lands
  const anchor = await service.anchorDocument('doc-nl', 1);
  expect(anchor.status).toBe('broadcast_unknown');
  const signedTx = anchor.signedTx;  // hmm — does the anchor DTO include signedTx? I said I don't return signedTx in the API, but the repo's StoredAnchor has it. The service returns a StoredAnchor? The API DTO is built in the controller? The controller shouldn't shape... the controller can pick fields (it's presentation). Let me have the service return a full StoredAnchor, and the controller maps to a public DTO (excluding signedTx). In the test I use the service directly → I get the signedTx.
  chain.setBroadcast(null); // the chain is back to normal: land + resolve
  await worker.runRecoveryPass(); // no receipt → re-broadcast the same signed tx
  const afterSweep = await repo.findAnchor('doc-nl', 1)!;
  expect(afterSweep.status).toBe('broadcast_sent');
  expect(chain.state.broadcastLog).toEqual([signedTx, signedTx]);
  await worker.runConfirmationPass();
  const confirmed = await repo.findAnchor('doc-nl', 1)!;
  expect(confirmed.status).toBe('confirmed');
  expect(confirmed.txId).toBe(anchor.txId);
  expect(await prisma.anchor.count({ where: { documentId: 'doc-nl', version: 1 } })).toBe(1);
});
```

**4. crash & restart:**
```ts
it('crash between broadcast and confirmation: restart recovers to exactly one anchor', async () => {
  await issue('doc-cr', 7, { b: [1,2,3] });
  // The chain accepts the tx, then the process dies (simulated) before the service persists the post-broadcast state.
  chain.setBroadcast((signedTx, txId, state) => { state.land(txId); throw new Error('simulated process crash'); });
  const anchor = await service.anchorDocument('doc-cr', 7);
  expect(anchor.status).toBe('broadcast_unknown');
  const txId = anchor.txId;
  // "restart": a fresh client over the same chain (the chain retains the tx; the app state is gone).
  const restarted = makeProcess();
  await restarted.worker.runRecoveryPass(); // chain first: the receipt exists → confirm, no re-broadcast
  const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-cr', version: 7 } });
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('CONFIRMED'); // the raw prisma row: the enum value
  expect(rows[0].txId).toBe(txId);
  expect(chainState.broadcastLog.length).toBe(1); // the tx was broadcast exactly once in total
});
```

Note: makeProcess returns a new InMemoryChainClient over the shared chainState — the new client's txIds map is empty, but recovery only needs getReceipt(txId) → the state has it.

Also, a comment explaining the fidelity of the crash emulation: a true SIGKILL would leave `prepared`; here the service's error handling leaves `broadcast_unknown`; both are limbo states that the sweep resolves chain-first, and the write-ahead row with the txId is what makes recovery possible.

**5. uniqueness:**
```ts
it('anchoring the same (document, version) twice is rejected by the database', async () => {
  await issue('doc-uq', 2, { x: true });
  const [first, second] = await Promise.allSettled([
    service.anchorDocument('doc-uq', 2),
    service.anchorDocument('doc-uq', 2),
  ]);
  const outcomes = [first, second];
  const rejected = outcomes.filter(o => o.status === 'rejected');
  const fulfilled = outcomes.filter(o => o.status === 'fulfilled');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  const err = (rejected[0] as PromiseRejectedResult).reason;
  expect(err).toBeInstanceOf(DomainException);
  expect((err as DomainException).code).toBe('anchor_conflict');
  const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-uq', version: 2 } });
  expect(rows).toHaveLength(1);
});
```

Two concurrent anchorDocument on the same pair: both prepare the same txId (deterministic), both attempt create → one wins, the other gets P2002 → anchor_conflict. The loser might have broadcast? The loser's create fails before the broadcast → no. The winner's broadcast proceeds (the default behavior lands immediately). Assert one row, one tx identity.

Also a sequential case: after the first is confirmed, the second call → also rejected (409). Let me add a small subtest:
```ts
it('re-anchoring a confirmed version is rejected', ...) 
```
Could fold into the same test: after Promise.allSettled, call anchorDocument again → expect the conflict. Let me add that assertion to the same test (the third call). Good.

**6. verify:**
```ts
it('verify returns the on-chain proof for matching content', async () => {
  const content = { report: { patient: 'anon-1', values: [1, 2.5, 'ok'] }, issued: '2025-01-01' };
  await issue('doc-vf', 5, content);
  await service.anchorDocument('doc-vf', 5);
  await worker.runConfirmationPass();
  const row = await repo.findAnchor('doc-vf', 5)!;
  expect(row.status).toBe('confirmed');
  const proof = await service.verify('doc-vf', 5, { values: [1, 2.5, 'ok'], report: { patient: 'anon-1' }, issued: '2025-01-01' });
  // note: a different key order in the supplied content → same hash (canonicalization) → match!
  expect(proof.match).toBe(true);
  expect(proof.proof).toEqual({ txId: row.txId, blockNumber: row.blockNumber, blockHash: <the receipt's blockHash> });
  expect(proof.differences).toEqual([]);
});
```
The blockHash: from the stored receipt json — the row.receipt has it. `proof.proof.blockHash === row.receipt.blockHash`. The repo's StoredAnchor.receipt: `{ txId, blockNumber, blockHash, status } | null`.

```ts
it('verify returns a mismatch report that says what differs', async () => {
  const content = { patient: 'anon-9', labs: { hgb: 12.5, wbc: 6.1 }, flags: [] };
  await issue('doc-mm', 1, content);
  await service.anchorDocument('doc-mm', 1);
  await worker.runConfirmationPass();
  const tampered = { patient: 'ANON-9', labs: { hgb: 13.0, wbc: 6.1 }, flags: ['review'], extra: 1 };
  const report = await service.verify('doc-mm', 1, tampered);
  expect(report.match).toBe(false);
  expect(report.storedContentHash).not.toBe(report.suppliedContentHash);
  const paths = report.differences.map(d => d.path).sort();
  expect(paths).toContain('$.patient');
  expect(paths).toContain('$.labs.hgb');
  expect(paths).toContain('$.flags[0]');
  expect(paths).toContain('$.extra');
  const extra = report.differences.find(d => d.path === '$.extra')!;
  expect(extra.kind).toBe('missing_in_stored');
  expect(extra.supplied).toBe(1);
  const patient = report.differences.find(d => d.path === '$.patient')!;
  expect(patient.kind).toBe('value');
  expect(patient.stored).toBe('anon-9');
  expect(patient.supplied).toBe('ANON-9');
  // proof must not be presented for mismatched content
  expect(report.proof).toBeNull();
});
```

Hmm — proof is null for a mismatch: the design decision: the proof is only returned when match && confirmed. For a mismatch, returning the anchor proof would be misleading (the proof is for the stored content). Let me document: proof is null unless the supplied content hashes to the anchored hash AND the anchor is confirmed. The response includes anchorState so the caller can see confirmed. Good.

Wait, `flags: []` vs `['review']` → the diff path `$.flags[0]` kind missing_in_stored. And an empty array vs a non-empty one → index 0 missing_in_stored. Good.

Also a pending verify test:
```ts
it('verify reports pending state (no block yet) for matching content on an unconfirmed anchor', async () => {
  chain.setBroadcast(() => new Promise(() => {})); // hang → unknown, never confirmed
  await issue('doc-pd', 1, { a: 1 });
  const anchor = await service.anchorDocument('doc-pd', 1);
  const report = await service.verify('doc-pd', 1, { a: 1 });
  expect(report.match).toBe(true);
  expect(report.anchorState).toBe('broadcast_unknown');
  expect(report.proof).toBeNull();
});
```

And a 404:
```ts
it('verify and anchor reject unknown document versions and unanchored versions', async () => {
  await expect(service.anchorDocument('ghost', 1)).rejects.toMatchObject({ code: 'document_version_not_found', httpStatus: 404 });
  await expect(service.verify('ghost', 1, { a: 1 })).rejects.toMatchObject({ code: 'document_version_not_found' });
  await issue('doc-vn', 1, { a: 1 });
  await expect(service.verify('doc-vn', 1, { a: 1 })).rejects.toMatchObject({ code: 'anchor_not_found' });
});
```

**Canonicalization unit tests** (behavioral spec):
```ts
it('canonicalization is order-insensitive and number-normalizing (per the written spec)', () => {
  const h1 = canonicalHash({ b: 1, a: { d: 2, c: [true, null] } });
  const h2 = canonicalHash({ a: { c: [true, null], d: 2 }, b: 1 });
  expect(h1).toBe(h2);
  const h3 = canonicalHash({ n: 1.10, m: 1e2 });
  const h4 = canonicalHash({ n: 1.1, m: 100 });
  expect(h3).toBe(h4);
  expect(canonicalize({ a: 1 })).toBe('{"a":1}');
  expect(canonicalize({ s: 'x"y', u: 'é' })).toBe('{"s":"x\\"y","u":"é"}');
  // the hash is 64 lowercase hex chars
  expect(h1).toMatch(/^[0-9a-f]{64}$/);
});
```
Wait — `JSON.stringify('é')` → 'é' (no escape; JSON.stringify only escapes control chars, quotes, backslash; non-ASCII passes through). Yes 'é' stays. The example is OK. `1e2` parses to 100 → stringify "100" → equal to 100. Good.

Where does this spec test go? In the same anchoring.spec.ts (describe 'canonicalization'). Fine.

**API / HTTP envelope test** — `test/anchoring.api.spec.ts`:

```ts
import { INestApplication, ValidationPipe? } from ...
import { Test } from '@nestjs/testing';
import { AnchoringModule } from '../src/anchoring/anchoring.module.js';
import { AppModule? no — a testing module with AnchoringModule + PrismaModule? AnchoringModule imports PrismaModule itself. So:
const moduleRef = await Test.createTestingModule({ imports: [AnchoringModule] }).compile();
const app = moduleRef.createNestApplication();
app.useGlobalFilters(new AllExceptionsFilter());
await app.init();
app.listen? app.init() doesn't listen. `await app.listen(0)` then `app.getUrl()`.
```

beforeAll: set the env for large intervals: `process.env.ANCHORING_CONFIRMATION_POLL_MS = '3600000'` etc. (before module creation). Prisma connect: AnchoringModule's PrismaModule → the PrismaService's onModuleInit auto-connects on app.init().

Tests:
```ts
it('rejects a malformed version with the standard error envelope (400)', async () => {
  const res = await fetch(`${base}/documents/doc-x/versions/not-a-number/anchors`, { method: 'POST' });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body).toMatchObject({ error: { code: 'validation_error', details: {} } });
  expect(typeof body.error.message).toBe('string');
});
it('reports a missing document version with 404 + document_version_not_found', ...);
it('anchors via HTTP and returns the persisted anchor identity (201)', async () => {
  // issue the version via HTTP
  const issue = await fetch(`${base}/documents/doc-http/versions/1`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ version: 1, content: { a: 1 } }) });
  expect(issue.status).toBe(201);
  const anchor = await fetch(`${base}/documents/doc-http/versions/1/anchors`, { method: 'POST' });
  expect(anchor.status).toBe(201);
  const a = await anchor.json();
  expect(a.status).toBe('broadcast_sent'); // default fake: broadcast resolves immediately
  expect(a.txId).toBeTruthy();
});
it('verify via HTTP returns the envelope shape on mismatch (200 with match:false)', ...)
```

afterAll: `await app.close()`.

DB cleanup for the API test: beforeAll deletes the table, afterAll too. The PrismaService from the module: `app.get(PrismaService)`.

The worker runs in the background during the API test (interval 1h → harmless; stuckAfter 60s default — wait, I set only the interval env large; the stuckAfter default 60000 → the sweep won't touch fresh rows even if it fires. The 1h confirmation interval won't fire during the test. OK.)

Note the env config provider factory:
```ts
{ provide: ANCHORING_CONFIG, useFactory: (): AnchoringConfig => ({
    broadcastTimeoutMs: intEnv('BROADCAST_TIMEOUT_MS', 30000),
    confirmationPollMs: intEnv('ANCHORING_CONFIRMATION_POLL_MS', 5000),
    recoverySweepMs: intEnv('ANCHORING_RECOVERY_SWEEP_MS', 60000),
    stuckAfterMs: intEnv('ANCHORING_STUCK_AFTER_MS', 60000),
}) }
```
intEnv: parse, default on NaN/<=0? Allow 0 (in tests, via direct construction, not env). For env, coerce: `const n = Number(v); return Number.isFinite(n) && n > 0 ? n : default`.

The worker's scheduling: schedule when ms > 0.

## The worker file

`src/anchoring/anchoring.worker.ts`:

```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ChainClient, CHAIN_CLIENT } from './chain-client.js';
import { AnchoringConfig, ANCHORING_CONFIG } from './anchoring.config.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { LIMIbo... } 
```

Let me define `ANCHORING_CONFIG` + the interface in `src/anchoring/anchoring.config.ts`.

Worker:
```ts
const WORKER_PAGE = 100;

@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Advance broadcast_sent anchors to confirmed/failed using receipts. */
  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], WORKER_PAGE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const to = receipt.status === 'success' ? 'confirmed' : 'failed';
      await this.repo.transition(row.id, ['broadcast_sent'], to, { blockNumber: receipt.blockNumber, receipt });
    }
  }

  /** Resolve anchors stuck in broadcast-limbo by asking the chain first. */
  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck(['prepared', 'broadcast_unknown'], stuckBefore, WORKER_PAGE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId); // chain first
      if (receipt) {
        const to = receipt.status === 'success' ? 'confirmed' : 'failed';
        await this.repo.transition(row.id, ['prepared', 'broadcast_unknown'], to, { blockNumber: receipt.blockNumber, receipt });
        continue;
      }
      // No trace on chain: re-broadcast the same signed tx (a new prepare is forbidden: it would be a second anchor).
      const outcome = await this.attemptBroadcast(row.signedTx);
      const to = outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown';
      await this.repo.transition(row.id, ['prepared', 'broadcast_unknown'], to, { incrementBroadcastAttempts: true });
    }
  }

  private async attemptBroadcast(signedTx: string): Promise<'sent' | 'unknown'> { ... same as service ... }
}
```

Duplicate attemptBroadcast across service + worker → extract to a shared helper `src/anchoring/broadcast.ts`:
```ts
export async function attemptBroadcast(chain: ChainClient, signedTx: string, timeoutMs: number): Promise<'sent' | 'unknown'> {
  const raw = Promise.resolve().then(() => chain.broadcast(signedTx));
  raw.catch(() => { /* the outcome is handled by the state machine; avoid unhandled rejection if the timeout wins */ });
  try {
    await Promise.race([raw, new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('broadcast timeout')), timeoutMs); (t as any).unref?.(); })]);
    return 'sent';
  } catch {
    return 'unknown';
  }
}
```
unref on the timeout so it doesn't keep the process alive. But the Promise.race's rejection: the timeout promise rejects → the race rejects → caught. The raw promise might later resolve/reject — the .catch attached; if it later *resolves*, no issue. OK.

Note: the setTimeout callback's reject keeps the timer until it fires; unref lets the process exit. Good.

The transition for the re-broadcast: from ['prepared','broadcast_unknown'] to 'broadcast_sent'/'broadcast_unknown'. If two replicas race, one wins; the loser's transition returns false — the loser's re-broadcast already happened (duplicate broadcast of the same signedTx — harmless, the chain deduplicates). A comment notes that.

## The service file

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CHAIN_CLIENT, ChainClient } from './chain-client.js';
import { ANCHORING_CONFIG, AnchoringConfig } from './anchoring.config.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { canonicalHash } from './canonicalize.js';
import { diffJson } from './content-diff.js';
import { attemptBroadcast } from './broadcast.js';
import { anchorNotFoundError, documentVersionNotFoundError, invalidAnchorContentError, DomainException } from '../common/exceptions.js';
import type { StoredAnchor, StoredVersion } from './anchoring.repository.js';

export interface VerificationReport {
  documentId: string;
  version: number;
  storedContentHash: string;
  suppliedContentHash: string;
  match: boolean;
  anchorState: string; // 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed'
  proof: { txId: string; blockNumber: number; blockHash: string } | null;
  differences: ContentDifference[];
}

@Injectable()
export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    try { canonicalHash(content); } catch (e) { throw invalidAnchorContentError(message(e)); }
    return this.repo.createVersion(documentId, version, content);
  }

  async anchorDocument(documentId: string, version: number): Promise<StoredAnchor> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);
    let contentHash: string;
    try { contentHash = canonicalHash(versionRow.content); } catch (e) { throw invalidAnchorContentError(message(e)); }

    // 1) The tx identity exists before the broadcast (prepare is local and deterministic).
    const prepared = this.chain.prepare({ documentId, version, contentHash });

    // 2) Write-ahead: persist the intent including the tx identity and commit before the broadcast.
    //    Even if we die at any point after this, recovery can ask the chain with the txId.
    const anchor = await this.repo.createAnchor({ documentId, version, contentHash, txId: prepared.txId, signedTx: prepared.signedTx });

    // 3) Only now do we broadcast. Confirmation comes later from a receipt, never from this call.
    const outcome = await attemptBroadcast(this.chain, anchor.signedTx, this.config.broadcastTimeoutMs);
    const to = outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown';
    await this.repo.transition(anchor.id, ['prepared'], to, { incrementBroadcastAttempts: true });
    const fresh = await this.repo.findById(anchor.id);
    return fresh ?? anchor;
  }

  async verify(documentId: string, version: number, supplied: unknown): Promise<VerificationReport> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);
    let suppliedHash: string;
    try { suppliedHash = canonicalHash(supplied); } catch (e) { throw invalidAnchorContentError(message(e)); }
    const anchor = await this.repo.findAnchor(documentId, version);
    if (!anchor) throw anchorNotFoundError(documentId, version);
    const match = suppliedHash === anchor.contentHash;
    const differences = match ? [] : diffJson(versionRow.content, supplied);
    const confirmed = anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt !== null;
    return {
      documentId, version,
      storedContentHash: anchor.contentHash,
      suppliedContentHash: suppliedHash,
      match,
      anchorState: anchor.status,
      proof: confirmed && match ? { txId: anchor.txId, blockNumber: anchor.blockNumber!, blockHash: anchor.receipt!.blockHash } : null,
      differences,
    };
  }
}
```

`message(e)`: `e instanceof Error ? e.message : String(e)`.

The receipt's type: StoredAnchor.receipt: `{ txId: string; blockNumber: number; blockHash: string; status: 'success' | 'failure' } | null`.

Note: `confirmed && match` — for a mismatch, proof is null. For a match but a failed anchor, proof is null + anchorState 'failed'. Good.

## The repository file

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClientKnownRequestError } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { anchorConflictError, documentVersionConflictError, DomainException } from '../common/exceptions.js';

export type AnchorState = 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed';

export interface StoredVersion { id: string; documentId: string; version: number; content: unknown; createdAt: Date; }
export interface ChainReceiptRecord { txId: string; blockNumber: number; blockHash: string; status: 'success' | 'failure'; }
export interface StoredAnchor {
  id: string; documentId: string; version: number; status: AnchorState;
  contentHash: string; txId: string; signedTx: string;
  blockNumber: number | null; receipt: ChainReceiptRecord | null;
  broadcastAttempts: number; createdAt: Date; updatedAt: Date;
}

const DB_TO_STATE: Record<string, AnchorState> = {
  prepared: 'prepared', broadcast_sent: 'broadcast_sent', broadcast_unknown: 'broadcast_unknown', confirmed: 'confirmed', failed: 'failed',
};
```

Hmm — the Prisma-generated enum: the row.status is the TS enum value 'BROADCAST_SENT' etc. So the map's keys should be the TS enum values:
```ts
import { AnchorStatus } from '@prisma/client';
const DB_TO_STATE: Record<AnchorStatus, AnchorState> = {
  [AnchorStatus.PREPARED]: 'prepared',
  [AnchorStatus.BROADCAST_SENT]: 'broadcast_sent',
  [AnchorStatus.BROADCAST_UNKNOWN]: 'broadcast_unknown',
  [AnchorStatus.CONFIRMED]: 'confirmed',
  [AnchorStatus.FAILED]: 'failed',
};
const STATE_TO_DB: Record<AnchorState, AnchorStatus> = { ...inverse... };
```

The methods:

```ts
async findVersion(documentId: string, version: number): Promise<StoredVersion | null> {
  const row = await this.prisma.documentVersion.findUnique({ where: { documentId_version: { documentId, version } } });
  if (!row) return null;
  return { id: row.id, documentId: row.documentId, version: row.version, content: row.content, createdAt: row.createdAt };
}

async createVersion(documentId, version, content): Promise<StoredVersion> {
  try {
    await this.prisma.$transaction(async (tx) => {
      await tx.document.upsert({ where: { id: documentId }, update: {}, create: { id: documentId } });
      await tx.documentVersion.create({ data: { documentId, version, content: content as Prisma.InputJsonValue } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw documentVersionConflictError(documentId, version);
    throw e;
  }
  const row = await this.findVersion(documentId, version);
  if (!row) throw new DomainException('internal_error', 'version was not persisted', 500);
  return row;
}

async createAnchor(data: { documentId: string; version: number; contentHash: string; txId: string; signedTx: string }): Promise<StoredAnchor> {
  try {
    const row = await this.prisma.anchor.create({ data: { ...data, status: AnchorStatus.PREPARED } });
    return toStoredAnchor(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw anchorConflictError(data.documentId, data.version);
    throw e;
  }
}

async findAnchor(documentId, version) { const row = await this.prisma.anchor.findUnique({ where: { documentId_version: { documentId, version } } }); return row ? toStoredAnchor(row) : null; }
async findById(id) { const row = await this.prisma.anchor.findUnique({ where: { id } }); return row ? toStoredAnchor(row) : null; }
async listByStatuses(states: AnchorState[], limit: number) {
  const rows = await this.prisma.anchor.findMany({ where: { status: { in: states.map(s => STATE_TO_DB[s]) } }, orderBy: { updatedAt: 'asc' }, take: limit });
  return rows.map(toStoredAnchor);
}
async listStuck(states, before, limit) {
  const rows = await this.prisma.anchor.findMany({ where: { status: { in: ... }, updatedAt: { lt: before } }, orderBy: { updatedAt: 'asc' }, take: limit });
  return rows.map(toStoredAnchor);
}
async transition(id, from: AnchorState[], to: AnchorState, extra: { blockNumber?: number; receipt?: ChainReceiptRecord; incrementBroadcastAttempts?: boolean } = {}): Promise<boolean> {
  const data: Prisma.AnchorUpdateManyMutationInput = { status: STATE_TO_DB[to] };
  if (extra.blockNumber !== undefined) data.blockNumber = extra.blockNumber;
  if (extra.receipt !== undefined) data.receipt = extra.receipt as Prisma.InputJsonValue;
  if (extra.incrementBroadcastAttempts) data.broadcastAttempts = { increment: 1 };
  const res = await this.prisma.anchor.updateMany({ where: { id, status: { in: from.map(s => STATE_TO_DB[s]) } }, data });
  return res.count > 0;
}
```

isUniqueViolation:
```ts
function isUniqueViolation(e: unknown): boolean {
  return e instanceof PrismaClientKnownRequestError && e.code === 'P2002';
}
```

toStoredAnchor: a mapper using DB_TO_STATE, parsing the receipt: `row.receipt ? (row.receipt as unknown as ChainReceiptRecord) : null`.

Note: the Prisma import in the repository — allowed (the repository touches the DB).

## content-diff.ts

```ts
export interface ContentDifference {
  path: string;
  kind: 'value' | 'missing_in_supplied' | 'missing_in_stored';
  stored?: unknown;
  supplied?: unknown;
}

export function diffJson(stored: unknown, supplied: unknown): ContentDifference[] {
  const out: ContentDifference[] = [];
  walk(stored, supplied, '$', out);
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function walk(stored: unknown, supplied: unknown, path: string, out: ContentDifference[]): void {
  if (Array.isArray(stored) && Array.isArray(supplied)) {
    const shared = Math.min(stored.length, supplied.length);
    for (let i = 0; i < shared; i++) walk(stored[i], supplied[i], `${path}[${i}]`, out);
    for (let i = shared; i < stored.length; i++) out.push({ path: `${path}[${i}]`, kind: 'missing_in_supplied', stored: stored[i] });
    for (let i = shared; i < supplied.length; i++) out.push({ path: `${path}[${i}]`, kind: 'missing_in_stored', supplied: supplied[i] });
    return;
  }
  if (isPlainObject(stored) && isPlainObject(supplied)) {
    const keys = Array.from(new Set([...Object.keys(stored), ...Object.keys(supplied)])).sort();
    for (const k of keys) {
      const child = `${path}.${k}`;
      if (!(k in stored)) out.push({ path: child, kind: 'missing_in_stored', supplied: supplied[k] });
      else if (!(k in supplied)) out.push({ path: child, kind: 'missing_in_supplied', stored: stored[k] });
      else walk(stored[k], supplied[k], child, out);
    }
    return;
  }
  if (!primitiveEqual(stored, supplied)) out.push({ path, kind: 'value', stored, supplied });
}

function primitiveEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' || typeof b === 'object') return false; // the mixed/object case: treat as different
  return a === b;
}
```

Wait — the mixed case (one is an object, the other isn't): falls to the last branch; `a===b` is false → a value difference with stored/supplied set to objects — serializing an object in a difference entry is fine (JSON). OK.

Note: for a `value` kind where both are primitives — fine.

## canonicalize.ts

```ts
import { createHash } from 'node:crypto';

/**
 * Canonical serialization of report content.
 * Full spec: docs/canonicalization.md — an auditor must be able to reproduce
 * this from the document alone.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`non-finite number cannot be canonically serialized: ${value}`);
      return JSON.stringify(value);
    case 'string': return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`unsupported value type in report content: ${typeof value}`);
  }
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
```

## exceptions.ts

```ts
export interface ErrorEnvelope { error: { code: string; message: string; details: Record<string, unknown> } }

export class DomainException extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus: number, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

export const validationError = (message: string, details: Record<string, unknown> = {}) => new DomainException('validation_error', message, 400, details);
export const documentVersionNotFoundError = (documentId: string, version: number) => new DomainException('document_version_not_found', `document ${documentId} version ${version} was not issued`, 404, { documentId, version });
export const documentVersionConflictError = (documentId: string, version: number) => new DomainException('document_version_conflict', `document ${documentId} version ${version} was already issued`, 409, { documentId, version });
export const anchorNotFoundError = (documentId: string, version: number) => new DomainException('anchor_not_found', `no anchor exists for document ${documentId} version ${version}`, 404, { documentId, version });
export const anchorConflictError = (documentId: string, version: number) => new DomainException('anchor_conflict', `an anchor already exists for document ${documentId} version ${version}`, 409, { documentId, version });
export const invalidAnchorContentError = (reason: string) => new DomainException('invalid_anchor_content', `report content cannot be anchored: ${reason}`, 422, { reason });
```

## all-exceptions.filter.ts

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const { status, envelope } = this.describe(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    res.status(status).json(envelope);
  }

  private describe(exception: unknown): { status: number; envelope: { error: { code: string; message: string; details: Record<string, unknown> } } } {
    if (exception instanceof DomainException) {
      return { status: exception.httpStatus, envelope: { error: { code: exception.code, message: exception.message, details: exception.details } } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const p = payload as { error: { code?: unknown; message?: unknown; details?: unknown } };
        if (typeof p.error.code === 'string') return { status, envelope: { error: { code: p.error.code, message: String(p.error.message ?? exception.message), details: (p.error.details as Record<string, unknown>) ?? {} } } };
      }
      const code = status === 400 ? 'validation_error' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : status === 422 ? 'unprocessable_content' : 'http_error';
      return { status, envelope: { error: { code, message: exception.message, details: {} } } };
    }
    return { status: 500, envelope: { error: { code: 'internal_error', message: 'internal server error', details: {} } } };
  }
}
```

The controller throws a DomainException (with httpStatus), so it's handled in the first branch.

## anchoring.controller.ts

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { AnchoringService, VerificationReport } from './anchoring.service.js';
import { validationError } from '../common/exceptions.js';
import type { StoredAnchor } from './anchoring.repository.js';

@Controller('documents')
export class AnchoringController {
  constructor(private readonly anchoring: AnchoringService) {}

  @Post(':documentId/versions')
  issueVersion(@Param('documentId') documentId: string, @Body() body: { version?: unknown; content?: unknown }) {
    const documentId_ = this.requireDocumentId(documentId);
    const version = this.requireVersion(body?.version);
    const content = this.requireContent(body?.content);
    return this.anchoring.createVersion(documentId_, version, content);
  }

  @Post(':documentId/versions/:version/anchors')
  createAnchor(@Param('documentId') documentId: string, @Param('version') version: string) {
    return this.anchoring.anchorDocument(this.requireDocumentId(documentId), this.requireVersion(version));
  }

  @Post(':documentId/versions/:version/anchors/verifications')
  @HttpCode(200)
  verify(@Param('documentId') documentId: string, @Param('version') version: string, @Body() body: { content?: unknown }) {
    return this.anchoring.verify(this.requireDocumentId(documentId), this.requireVersion(version), body?.content);
  }

  private requireDocumentId(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0) throw validationError('documentId must be a non-empty string', { documentId: raw });
    return raw;
  }
  private requireVersion(raw: unknown): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) throw validationError('version must be a positive integer', { version: raw });
    return version;
  }
  private requireContent(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw validationError('content must be a non-empty JSON object', {});
    return raw as Record<string, unknown};
  }
}
```

The POST default status is 201 for all three; verify is overridden to 200. The createVersion response: the StoredVersion (id, documentId, version, content, createdAt) — returning the full content is fine (it's ours). Hmm — returning a StoredVersion with a `content` unknown — the JSON is fine.

The controller returns StoredAnchor — including signedTx in the HTTP response? The signed tx is a "secret" in the real world (the key). "No real keys" — still, let me keep the API clean: exclude signedTx from the HTTP response. But the controller "has no business logic" — picking response fields is presentation, acceptable. Let me map: `const { signedTx, ...public_ } = anchor; return public_;` Hmm, a slight transformation — fine in the controller (presentation). Actually, is dropping signedTx "logic"? It's response shaping; standard. Let me do it.

Wait, but then in the API test, `a.txId` is present, `a.signedTx` is absent. In the service test, I use the service (which includes signedTx). Good.

## anchoring.config.ts

```ts
export interface AnchoringConfig {
  /** Give up waiting for broadcast() after this long; the outcome is then unknown. */
  broadcastTimeoutMs: number;
  /** How often the confirmation worker polls receipts (0 disables the timer). */
  confirmationPollMs: number;
  /** How often the recovery sweep runs (0 disables the timer). */
  recoverySweepMs: number;
  /** A limbo row must be at least this old before the sweep touches it (avoids racing with in-flight work). */
  stuckAfterMs: number;
}

export const ANCHORING_CONFIG = 'ANCHORING_CONFIG';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function anchoringConfigFromEnv(): AnchoringConfig {
  return {
    broadcastTimeoutMs: positiveInt('BROADCAST_TIMEOUT_MS', 30_000),
    confirmationPollMs: positiveInt('ANCHORING_CONFIRMATION_POLL_MS', 5_000),
    recoverySweepMs: positiveInt('ANCHORING_RECOVERY_SWEEP_MS', 60_000),
    stuckAfterMs: positiveInt('ANCHORING_STUCK_AFTER_MS', 60_000),
  };
}
```

## anchoring.module.ts

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchoringController } from './anchoring.controller.js';
import { AnchoringService } from './anchoring.service.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { AnchoringWorker } from './anchoring.worker.js';
import { CHAIN_CLIENT } from './chain-client.js';
import { InMemoryChainClient } from './in-memory-chain-client.js';
import { ANCHORING_CONFIG, anchoringConfigFromEnv } from './anchoring.config.js';

@Module({
  imports: [PrismaModule],
  controllers: [AnchoringController],
  providers: [
    AnchoringService,
    AnchoringRepository,
    AnchoringWorker,
    { provide: ANCHORING_CONFIG, useFactory: anchoringConfigFromEnv },
    // ASSUMPTION: no real L2 client is in scope ("no real keys, no RPC"), so the
    // in-process implementation is the default provider; a deployment replaces
    // this provider with a real ChainClient.
    { provide: CHAIN_CLIENT, useFactory: () => new InMemoryChainClient() },
  ],
  exports: [AnchoringService],
})
export class AnchoringModule {}
```

## prisma.module.ts / prisma.service.ts

```ts
// prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```

ESM + PrismaClient inheritance: known issue — PrismaClient in ESM... does it work with `import { PrismaClient } from '@prisma/client'`? There was an issue with extending PrismaClient in ESM with `prisma-client-js` — generally it works (people use it). OK.

## in-memory-chain-client.ts

```ts
import { createHash } from 'node:crypto';
import { ChainClient, ChainReceipt, ChainTxInput, PreparedTx } from './chain-client.js';

/**
 * Shared "chain" state: the part that survives a process restart
 * (a real L2 keeps accepting transactions regardless of our process state).
 */
export class InMemoryChainState {
  readonly receipts = new Map<string, ChainReceipt>();
  readonly broadcastLog: string[] = [];
  private nextBlock = 1;

  land(txId: string, status: 'success' | 'failure' = 'success'): void {
    if (this.receipts.has(txId)) return; // the chain deduplicates by tx identity
    this.receipts.set(txId, { txId, blockNumber: this.nextBlock++, blockHash: `blk_${txId.slice(0, 12)}`, status });
  }
}

/**
 * In-process ChainClient used by tests and as the default local implementation
 * (the task scopes out real keys / RPC).
 */
export class InMemoryChainClient implements ChainClient {
  private readonly txIds = new Map<string, string>();
  private behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null = null;

  constructor(readonly state: InMemoryChainState = new InMemoryChainState()) {}

  prepare(tx: ChainTxInput): PreparedTx {
    const digest = createHash('sha256').update(`${tx.documentId}|${tx.version}|${tx.contentHash}`).digest('hex');
    const txId = `tx_${digest.slice(0, 40)}`;
    const signedTx = `signed:${txId}`;
    this.txIds.set(signedTx, txId);
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = this.txIds.get(signedTx) ?? `tx_${createHash('sha256').update(signedTx).digest('hex').slice(0, 40)}`;
    this.state.broadcastLog.push(signedTx);
    if (this.behavior) await this.behavior(signedTx, txId, this.state);
    else this.state.land(txId);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.state.receipts.get(txId) ?? null;
  }

  /** Test hook: override the broadcast behavior (timeout, crash, no landing). null = default (land). */
  setBroadcast(behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null): void {
    this.behavior = behavior;
  }
}
```

Hmm — the behavior function may return a non-promise; `await` handles it. The crash behavior throws synchronously → the broadcast() rejects. Good.

Note: the broadcastLog includes every broadcast attempt (including duplicates) — used to assert "the same signed tx was re-broadcast."

## The chain-client.ts interface file

```ts
/**
 * The chain-client contract from the incident spec:
 *   prepare(tx)      -> {txId, signedTx}   local, deterministic
 *   broadcast(signedTx)                   may time out, outcome unknown
 *   getReceipt(txId)                      the receipt once included, else null
 * Confirmation always comes from getReceipt, never from broadcast().
 */
export interface ChainTxInput { documentId: string; version: number; contentHash: string; }
export interface PreparedTx { txId: string; signedTx: string; }
export interface ChainReceipt { txId: string; blockNumber: number; blockHash: string; status: 'success' | 'failure'; }
export interface ChainClient {
  prepare(tx: ChainTxInput): PreparedTx;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
export const CHAIN_CLIENT = 'CHAIN_CLIENT';
```

## The worker file

`src/anchoring/anchoring.worker.ts`:

```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ChainClient, CHAIN_CLIENT } from './chain-client.js';
import { AnchoringConfig, ANCHORING_CONFIG } from './anchoring.config.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';
import { LIMIbo... } 
```

Let me define `ANCHORING_CONFIG` + the interface in `src/anchoring/anchoring.config.ts`.

Worker:

```ts
const WORKER_PAGE = 100;

@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Advance broadcast_sent anchors to confirmed/failed using receipts. */
  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], WORKER_PAGE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const to = receipt.status === 'success' ? 'confirmed' : 'failed';
      await this.repo.transition(row.id, ['broadcast_sent'], to, { blockNumber: receipt.blockNumber, receipt });
    }
  }

  /** Resolve anchors stuck in broadcast-limbo by asking the chain first. */
  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck(['prepared', 'broadcast_unknown'], stuckBefore, WORKER_PAGE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId); // chain first
      if (receipt) {
        const to = receipt.status === 'success' ? 'confirmed' : 'failed';
        await this.repo.transition(row.id, ['prepared', 'broadcast_unknown'], to, { blockNumber: receipt.blockNumber, receipt });
        continue;
      }
      // No trace on chain: re-broadcast the same signed tx (a new prepare is forbidden: it would be a second anchor).
      const outcome = await this.attemptBroadcast(row.signedTx);
      const to = outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown';
      await this.repo.transition(row.id, ['prepared', 'broadcast_unknown'], to, { incrementBroadcastAttempts: true });
    }
  }

  private async attemptBroadcast(signedTx: string): Promise<'sent' | 'unknown'> { ... same as service ... }
}
```

The duplicate attemptBroadcast across service + worker → extract to a shared helper `src/anchoring/broadcast.ts`:
```ts
export async function attemptBroadcast(chain: ChainClient, signedTx: string, timeoutMs: number): Promise<'sent' | 'unknown'> {
  const raw = Promise.resolve().then(() => chain.broadcast(signedTx));
  raw.catch(() => { /* the outcome is handled by the state machine; avoid unhandled rejection if the timeout wins */ });
  try {
    await Promise.race([raw, new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('broadcast timeout')), timeoutMs); (t as any).unref?.(); })]);
    return 'sent';
  } catch {
    return 'unknown';
  }
}
```

The unref on the timeout so it doesn't keep the process alive. But the Promise.race's rejection: the timeout promise rejects → the race rejects → caught. The raw promise might later resolve/reject — the .catch attached; if it later *resolves*, no issue. OK.

Note: the setTimeout callback's reject keeps the timer until it fires; unref lets the process exit. Good.

The transition for the re-broadcast: from ['prepared','broadcast_unknown'] to 'broadcast_sent'/'broadcast_unknown'. If two replicas race, one wins; the loser's transition returns false — the loser's re-broadcast already happened (duplicate broadcast of the same signedTx — harmless, the chain deduplicates). A comment notes that.

## The service file

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CHAIN_CLIENT, ChainClient } from './chain-client.js';
import { ANCHORING_CONFIG, AnchoringConfig } from './anchoring.config.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { canonicalHash } from './canonicalize.js';
import { diffJson } from './content-diff.js';
import { attemptBroadcast } from './broadcast.js';
import { anchorNotFoundError, documentVersionNotFoundError, invalidAnchorContentError, DomainException } from '../common/exceptions.js';
import type { StoredAnchor, StoredVersion } from './anchoring.repository.js';

export interface VerificationReport {
  documentId: string;
  version: number;
  storedContentHash: string;
  suppliedContentHash: string;
  match: boolean;
  anchorState: string; // 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed'
  proof: { txId: string; blockNumber: number; blockHash: string } | null;
  differences: ContentDifference[];
}

@Injectable()
export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    try { canonicalHash(content); } catch (e) { throw invalidAnchorContentError(message(e)); }
    return this.repo.createVersion(documentId, version, content);
  }

  async anchorDocument(documentId: string, version: number): Promise<StoredAnchor> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);
    let contentHash: string;
    try { contentHash = canonicalHash(versionRow.content); } catch (e) { throw invalidAnchorContentError(message(e)); }

    // 1) The tx identity exists before the broadcast (prepare is local and deterministic).
    const prepared = this.chain.prepare({ documentId, version, contentHash });

    // 2) Write-ahead: persist the intent including the tx identity and commit before the broadcast.
    //    Even if we die at any point after this, recovery can ask the chain with the txId.
    const anchor = await this.repo.createAnchor({ documentId, version, contentHash, txId: prepared.txId, signedTx: prepared.signedTx });

    // 3) Only now do we broadcast. Confirmation comes later from a receipt, never from this call.
    const outcome = await attemptBroadcast(this.chain, anchor.signedTx, this.config.broadcastTimeoutMs);
    const to = outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown';
    await this.repo.transition(anchor.id, ['prepared'], to, { incrementBroadcastAttempts: true });
    const fresh = await this.repo.findById(anchor.id);
    return fresh ?? anchor;
  }

  async verify(documentId: string, version: number, supplied: unknown): Promise<VerificationReport> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);
    let suppliedHash: string;
    try { suppliedHash = canonicalHash(supplied); } catch (e) { throw invalidAnchorContentError(message(e)); }
    const anchor = await this.repo.findAnchor(documentId, version);
    if (!anchor) throw anchorNotFoundError(documentId, version);
    const match = suppliedHash === anchor.contentHash;
    const differences = match ? [] : diffJson(versionRow.content, supplied);
    const confirmed = anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt !== null;
    return {
      documentId, version,
      storedContentHash: anchor.contentHash,
      suppliedContentHash: suppliedHash,
      match,
      anchorState: anchor.status,
      proof: confirmed && match ? { txId: anchor.txId, blockNumber: anchor.blockNumber!, blockHash: anchor.receipt!.blockHash } : null,
      differences,
    };
  }
}
```

`message(e)`: `e instanceof Error ? e.message : String(e)`.

The receipt's type: StoredAnchor.receipt: `{ txId: string; blockNumber: number; blockHash: string; status: 'success' | 'failure' } | null`.

Note: `confirmed && match` — for a mismatch, proof is null. For a match but a failed anchor, proof is null + anchorState 'failed'. Good.

## Now — the API test module: does AnchoringModule's worker start the interval during the API test? Yes (onApplicationBootstrap via app.init()). Env override in beforeAll, before createTestingModule: set `ANCHORING_CONFIRMATION_POLL_MS=3600000`, `ANCHORING_RECOVERY_SWEEP_MS=3600000`. The config factory reads env at provider instantiation → large. Good.

The API test needs the DB: the PrismaService's onModuleInit connects.

beforeAll cleanup: `const prisma = app.get(PrismaService)` after creation. Order: create app → cleanup → tests → afterAll: cleanup + close.

The API test's fetch: Node 20 global fetch. `app.listen(0)`? `NestApplication.listen(0)` → random port; `app.getUrl()` returns `http://localhost:PORT`. Use that.

Now — a potential problem: `Test.createTestingModule({ imports: [AnchoringModule] })` — the module's providers include the worker; fine.

The filter is applied only to this app via `app.useGlobalFilters(new AllExceptionsFilter())` in the test (and also globally in main.ts). Good.

## main.ts

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

The reflect-metadata import: @nestjs/core imports it; explicit is safe.

app.module.ts:
```ts
import { Module } from '@nestjs/common';
import { AnchoringModule } from './anchoring/anchoring.module.js';

@Module({ imports: [AnchoringModule] })
export class AppModule {}
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": false,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Vitest compiles the tests itself (esbuild) — the tests aren't type-checked by this tsconfig; that's fine (I can add a tsconfig for tests, but skip — the convention doesn't require it; vitest doesn't type-check).

Hmm — `emitDecoratorMetadata` under NodeNext ESM: does Nest rely on decorator metadata for constructor injection?? In ESM, TS's emitDecoratorMetadata doesn't emit `design:paramtypes` in ESM output?? Actually, TypeScript doesn't support emitDecoratorMetadata well in ESM mode — it emits `design:paramtypes` only in CJS? No — TS emits decorator metadata in both, but there are known issues with ESM + decorator metadata (imports are used for metadata → works). NestJS's official ESM support: does Nest work in ESM with constructor injection? Known gotcha: in ESM, `design:paramtypes` references imports — TS emits them — but if you use `@Inject(CHAIN_CLIENT)`, the metadata is bypassed anyway. My injections: the repository (class), the config via @Inject(token), the chain via @Inject(token). PrismaService (class). For class-based injection without an explicit @Inject, Nest uses design:paramtypes — needs emitDecoratorMetadata to work under ESM. Does TS emit design:paramtypes in ESM output? Let me recall... I believe TS still emits design:paramtypes in ESM output (it adds references to the imported classes). There was an issue with `useDefineForClassFields`... Nest's docs on ESM (v10): it works; they recommend it; the metadata is emitted. Actually, I recall NestJS ESM had issues with `emitDecoratorMetadata` and people had to add `@Inject` explicitly? Hmm.

For safety, I could add explicit `@Inject` everywhere? Ugly. Or — do the tests use Nest DI? The API test uses Nest DI → if metadata fails, the injection breaks at runtime. Since the eval likely doesn't run, code correctness on paper matters; but I want it actually runnable. NestJS 10's ESM: the official docs state that NestJS supports ESM with `module: nodenext` and works including dependency injection (they added ESM support in v10). TS's design:paramtypes under ESM: TS emits it (it's part of the decorator emit; ESM doesn't prevent it). Let me trust it — Nest's own ESM docs example uses constructor injection. OK.

Another ESM gotcha: the `PrismaClient` import under NodeNext — does @prisma/client's package.json have `"exports"`? The generated client's index has a proper ESM entry. Yes, Prisma 5 supports ESM.

## The vitest config

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

Now — the test imports from src with the `.js` extension: vitest/vite resolves `../src/anchoring/anchoring.service.js` → to the .ts file? Vite's resolver: for TS, an import ending in `.js` maps to `.ts` — supported (Vite's "TypeScript ESM" behavior). Yes.

## Let me reconsider the worker's "stuckAfter" default 60s and the direct-construction config in the service spec: stuckAfterMs: 0. listStuck with before = now-0 → lt now → includes the row. A tiny race: the row's updatedAt is set by the DB at create time; by the time of the sweep, now > updatedAt. OK.

The write-ahead test: after the release(), anchorPromise resolves to the transitioned row → status broadcast_sent. Then the confirmation pass can confirm it — I assert the receipt's txId equals. Fine.

One more check — `waitForRow` polls with findAnchor every 10ms for up to 2s — the broadcast hangs (forever), so the service is stuck in attemptBroadcast; the row is created before that. Timing: the anchorDocument flow: findVersion (DB) → hash → prepare → createAnchor (DB) → attemptBroadcast (hangs for 100ms until the timeout → 'unknown' → transition). Wait — with the hanging broadcast, attemptBroadcast waits for the full broadcastTimeoutMs (100ms) before returning unknown. The row appears within the first ~50ms (two DB round trips). waitForRow catches it at status 'prepared'. Then release() (resolves the hang) — but the race already timed out at 100ms; the raw promise's resolution is ignored. anchorPromise resolves at ~100ms with broadcast_unknown — not broadcast_sent! My test expected broadcast_sent after the release. Timing bug!

Fix: make the broadcastTimeoutMs large enough (e.g., 2000ms), and release before the timeout. waitForRow returns quickly (<200ms), release() → the broadcast resolves → 'sent' → broadcast_sent. Let me set the config's broadcastTimeoutMs to 2000 in the spec. And for the timeout tests (2, 3), the broadcast hangs forever → the 2000ms wait per anchorDocument → the test takes 2s each. Acceptable (testTimeout 30s). Or a per-test config override: I can construct the service with different config per test. Simpler: a global config broadcastTimeoutMs: 300, and in the write-ahead test, release fast (waitForRow returns within ~100ms → release → resolve before the 300ms timeout → sent). The DB round trip on local Postgres is ~2-10ms; waitForRow's first check might be before the row exists → 10ms sleep → ~20-50ms. Release at <200ms, safely before the 300ms timeout. OK: a config broadcastTimeoutMs: 300. The timeout tests wait 300ms each — fine.

Hmm — but on a slow CI, the DB could be slower... the 300ms margin is probably OK; let me use 500ms for a safety margin. The timeout tests add 0.5s each. Fine.

Also the write-ahead test's assertion `expect(row.status).toBe('prepared')` — the row is found before the release; the transition happens only after the release (the service is stuck in attemptBroadcast). Safe.

**Crash test details**: the crash behavior throws synchronously inside broadcast() → `Promise.resolve().then(() => chain.broadcast(...))` rejects → attemptBroadcast catches → 'unknown' → the row is broadcast_unknown. Good.

**Uniqueness test**: the default broadcast (lands + resolves). Both calls: the loser throws on create (before broadcast) → no broadcast. The winner: broadcast → lands → broadcast_sent. Assert one row. Then the third sequential call → conflict again.

Wait — the third call: `expect(service.anchorDocument('doc-uq', 2)).rejects.toMatchObject({ code: 'anchor_conflict' })` — the service throws a DomainException with the code property → toMatchObject works on the instance (properties). DomainException has `code` as a public readonly — yes.

**Now the API spec**:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AnchoringModule } from '../src/anchoring/anchoring.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

describe('anchoring HTTP API', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    // keep the background workers quiet during this suite
    process.env.ANCHORING_CONFIRMATION_POLL_MS = '3600000';
    process.env.ANCHORING_RECOVERY_SWEEP_MS = '3600000';
    process.env.ANCHORING_STUCK_AFTER_MS = '3600000';
    const moduleRef = await Test.createTestingModule({ imports: [AnchoringModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    base = app.getUrl();
    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
  }, 60_000);

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await app.close();
  });
  ...
```

`app.getUrl()` after listen(0) — yes, returns the actual URL.

Tests:
1. A malformed version → 400 validation_error envelope:
```ts
const res = await fetch(`${base}/documents/doc-x/versions/not-an-int/anchors`, { method: 'POST' });
expect(res.status).toBe(400);
const body = await res.json() as { error: { code: string; message: string; details: Record<string, unknown> } };
expect(body.error.code).toBe('validation_error');
expect(typeof body.error.message).toBe('string');
expect(body.error.details).toEqual(expect.any(Object));
```
2. A missing version → 404 document_version_not_found (with a valid int version):
```ts
const res = await fetch(`${base}/documents/ghost-doc/versions/1/anchors`, { method: 'POST' });
expect(res.status).toBe(404);
expect((await res.json()).error.code).toBe('document_version_not_found');
```
3. The full happy path via HTTP: issue → anchor (201, status broadcast_sent, txId) → wait for confirmation? The worker is quiet (1h) → the status stays broadcast_sent. The verify with matching content → 200 match:true proof:null (not confirmed) — hmm, a bit unsatisfying; to get a proof via HTTP, run the confirmation... let me keep it: assert match true + anchorState broadcast_sent + proof null. Then a verify with tampered content → match false with differences.
4. The double-anchor via HTTP → the second POST anchor → 409 anchor_conflict.

That covers the envelope + the flow.

Now — the issue endpoint body: `{ version: 1, content: {...} }`. The response is 201 with the StoredVersion JSON.

Also note: the default InMemoryChainClient provider (the module) lands immediately on broadcast → the anchor endpoint returns quickly with broadcast_sent. Good.

**The document model's id**: `@id` without a default — I set it from the URL param. The Prisma model Document: `id String @id @map("id")`. No relation field needed for the version? I referenced the `versions` relation — the back-relation is required. The Document has a `versions DocumentVersion[]` field. The Document has no createdAt (dropped). The migration: documents(id TEXT PK).

The FK document_versions.document_id → documents.id ON DELETE CASCADE (the relation's onDelete: Cascade). The migration matches.

## Re-checking the convention compliance

- "controller validates input and calls service. No business logic." ✓ (validation helpers + one response shaping: stripping signedTx — hmm, is that logic? Presentation. Keep it, but minimal: spread omit.)

Actually wait — let me reconsider the stripping of signedTx: `const { signedTx: _signedTx, ...anchor } = await this.anchoring.anchorDocument(...); return anchor;` — TS strict's unused variable `_signedTx` — the noUnusedLocals? I haven't enabled noUnusedLocals in tsconfig → fine.

- "service has zero raw SQL and zero Prisma client calls." ✓ The service imports nothing from @prisma/client.
- "repository is the only layer that touches the database." ✓ (the worker/service don't touch prisma; the tests do — the tests are allowed to inspect the DB.)
- Naming: snake_case tables via @@map/@map ✓; the enum is mapped to a snake value ✓; endpoints are kebab-case plural ✓ (`documents`, `versions`, `anchors`, `verifications`); files are kebab-case.role.ts: `anchoring.module.ts`, `anchoring.controller.ts`, `anchoring.service.ts`, `anchoring.repository.ts`, `anchoring.worker.ts` ✓; utilities without a role: `chain-client.ts`, `in-memory-chain-client.ts`, `canonicalize.ts`, `content-diff.ts`, `broadcast.ts`, `anchoring.config.ts` — hmm `anchoring.config.ts` fits the pattern (the role "config"). OK.
- Error envelope ✓ details always an object ✓ code is snake_case ✓.
- Wiring: providers are listed ✓; PrismaModule is exported + imported ✓; the controller is declared ✓.
- Migrations ✓ (init migration + lock).
- Tests: behavior-based with assertions ✓.
- Config from env ✓.

## Wait — "TS file: kebab-case.role.ts" — my common files: `src/common/all-exceptions.filter.ts` — role "filter" ✓; `src/common/exceptions.ts` — no role suffix... let me name it `error-exceptions.ts`? Or `domain-exceptions.ts`? The rule: TS files follow that pattern. `exceptions.ts` deviates. Let me rename to `src/common/exceptions.exception.ts`?? Ugly. The pattern `<name>.role.ts` — exceptions is the name, and the role is... it's a definition file. `src/common/domain-exception.ts` (singular, a class definition) — "domain-exception.ts" is a file for a class; the .role pattern is for the feature layer files (module/controller/service/repository/worker/filter). A shared exception class file `domain-exception.ts` is acceptable I think. Let me use `src/common/domain-exception.ts` containing DomainException + factories. And the filter: `all-exceptions.filter.ts`. OK.

Hmm, also `prisma/prisma.module.ts` + `prisma/prisma.service.ts` — the feature-like folder `prisma` with module/service roles ✓.

## The blockNumber Int vs BigInt

L2 block numbers are usually < 2^53; Int (4 bytes, ~2.1e9) is tight for L1 eth (already ~22M, and by 2029? Mainnet ~21.7M in 2024, ~400k blocks/day → +4.6M/year → 2029 ~30M — fits Int). L2s (arbitrum ~2.5e8 in 2025? Arbitrum block height ~1e8... let me think: Arbitrum One ~2.5e8? Actually Arbitrum has ~4.4 blocks/sec? no — 1 block per ~250ms? no. Arbitrum: ~1 block/sec? its height is ~2e8 by 2025? hmm, that's over 2.1e9? no 2e8 < 2.1e9 fine. Optimism ~1.4e8. Base similar. In 4 years: +4e7/year → still < 2.1e9. Int is fine. But BigInt is safer and Prisma supports BigInt → the JSON serialization issue (BigInt isn't JSON-serializable → Nest 500 on response!). blockNumber BigInt in a Prisma row → I map to the repository DTO as a number (`Number(row.blockNumber)`) → JSON-safe. Let me use BigInt in the schema (honest for block numbers) and convert in the repository. The receipt json (Json) stores a blockNumber number (from the chain receipt, my interface is number) — the mismatch between the receipt json's number and the column's BigInt — fine.

Hmm, `blockNumber BigInt? @map("block_number")` → the migration is BIGINT. The repository: `blockNumber: row.blockNumber === null ? null : Number(row.blockNumber)`. OK.

Actually — is the complexity worth it? Int is simpler; but BigInt is more correct for chain block numbers. Let me go with BigInt with the Number() conversion (safe for any realistic value; Number is precise up to 2^53).

## The receipt Json column

Store the ChainReceiptRecord — the repository writes `data.receipt = extra.receipt as Prisma.InputJsonValue`. Reading: cast. OK.

## Now let me write the canonicalization doc in full (deliverable "documented canonicalization"):

`docs/canonicalization.md`:

```md
# Canonicalization of report content

The structured JSON of an issued report version is the source of truth.
The PDF is a rendering of that JSON and is never part of the hash.

## What is hashed

`SHA-256(canonical_bytes)` where `canonical_bytes` is the UTF-8 encoding of
the canonical serialization below. The hash is 64 lowercase hex characters.

## Canonical serialization rules

Input: the parsed JSON value of the stored report version (a JSON object).

1. Objects:
   - Keys are sorted lexicographically in UTF-16 code unit order (the default
     JavaScript `Array.prototype.sort` on strings) and emitted in that order.
   - A key whose value is `undefined` is omitted entirely (JSON.stringify
     semantics; after JSON.parse this cannot occur, so stored and supplied
     content behave identically).
   - Emitted as `{"k1":v1,"k2":v2}` — no whitespace between tokens.
2. Arrays: element order is significant and preserved; emitted as
   `[e1,e2,...]`.
3. Strings: emitted with `JSON.stringify` escaping (quotes, backslashes and
   control characters are escaped; other Unicode passes through as-is).
4. Numbers: emitted as the shortest decimal string that round-trips to the
   same IEEE-754 double — exactly what `JSON.stringify` produces
   (`12.5`, `100`, `1e+21`). Consequently `1.10` and `1.1` canonicalize
   identically, as do `1e2` and `100`. Non-finite values (NaN, ±Infinity)
   are not valid JSON and are rejected, not hashed.
5. `true`, `false`, `null`: the literals `true`, `false`, `null`.
6. No other JSON values exist; any other JavaScript type is rejected.

## Worked example

```
input:      { "b": 1, "a": { "d": 2, "c": [true, null] } }
canonical:  {"a":{"c":[true,null],"d":2},"b":1}
hash:       sha256 over the UTF-8 bytes of the canonical string,
            written as 64 lowercase hex characters.
```

## What does not affect the hash

- Key insertion order in objects.
- Whitespace or formatting of the original JSON text.
- The PDF rendering, file names, or metadata.
- Numeric notation that denotes the same double (`1.10` ≡ `1.1`).

## Reproduction

An auditor with the stored (or supplied) content recomputes the hash as:
parse JSON → apply the rules above → UTF-8 encode → SHA-256 → lowercase hex.
Reference implementation: `src/anchoring/canonicalize.ts`
(`canonicalize` / `canonicalHash`).
```

Wait — I need to double-check `JSON.stringify(1e21)` → "1e+21". And 1e2 → "100". Yes.

The doc has a fenced code block inside a fenced block in my reply — the format: each file is one fenced block. A doc file containing a ``` inside would break the outer fence! I need to avoid triple backticks inside the doc file, or use a different fence. Let me write the doc with indented code blocks or a single backtick for the example, avoiding a triple-backtick fence inside. Let me use a 4-space indent for the example.

## Re-check: the "crash between broadcast and (wrong) late persistence" test in variant A

"A test that crashes the process between broadcast and the (naive) late persistence." My crash test: land + throw simulates a crash right after the chain's acceptance (between the broadcast and the post-broadcast persistence). ✓ "then restarts and recovers — and shows exactly one anchor and one tx identity." ✓ (rows length 1, txId equal, broadcastLog length 1).

To make the "process crash" more literal, let me structure the test to name it clearly:

```ts
it('process crash between broadcast and confirmation: restart recovers exactly one anchor', ...)
```

With the comment:
```
// A real SIGKILL would kill the process right after the chain accepted the tx,
// before any post-broadcast state write. We simulate that here: the chain
// records the tx, then the service call fails as if the process died. The
// persisted row may be left 'prepared' (true SIGKILL) or 'broadcast_unknown'
// (this simulation); both are limbo states the recovery sweep must resolve
// by asking the chain first, using the write-ahead tx identity.
```

Good.

## Now — a subtle issue with `Promise.allSettled` in the uniqueness test: both services are the same instance; the two anchorDocument calls run concurrently: both findVersion, both prepare (same txId), both createAnchor — the DB's unique constraint serializes; one succeeds, the other P2002. ✓. The winner continues to broadcast (the default lands). ✓.

But note: the loser throws AnchorConflict — but only after both have... yes, the loser's create fails → throws immediately. ✓.

## Edge: the `document.upsert` in createVersion under concurrency in the uniqueness test — not applicable (one version creation).

## The worker's listStuck with stuckAfterMs 0 in the service spec: `new Date(Date.now() - 0)`. The row's updatedAt is strictly less than now (ms resolution — the row is written at least 1ms earlier? The create happens, then several awaits (the 300ms broadcast wait) → definitely >1ms. ✓.

## The verify pending test: the broadcast hangs (no land). The row: broadcast_unknown after 500ms. verify: match true, anchorState broadcast_unknown, proof null. ✓.

## Now, let me re-check the `attemptBroadcast` timeout implementation for unhandled rejections:

```ts
export async function attemptBroadcast(chain: ChainClient, signedTx: string, timeoutMs: number): Promise<'sent' | 'unknown'> {
  const broadcast = Promise.resolve().then(() => chain.broadcast(signedTx));
  broadcast.catch(() => undefined); // a late rejection must not crash the process; the state machine decides
  try {
    await Promise.race([
      broadcast,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('broadcast timed out')), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return 'sent';
  } catch {
    return 'unknown';
  }
}
```

`setTimeout` in Node returns a Timeout with unref — the TS type: `NodeJS.Timeout` — `timer.unref()` is fine (no ?.). In the browser it'd be a number — we're on Node. Use `timer.unref();` directly.

The timer keeps the event loop alive until it fires (500ms) — the unref fixes it.

The hanging broadcast promise (never settles) — no problem for the process exit (a pending promise doesn't keep the loop alive; its internal await is just a Promise).

## The repository's `content` Json typing: `content: content as Prisma.InputJsonValue`. ✓.

The findVersion return `content: row.content` — row.content is JsonValue (unknown-ish) → StoredVersion.content: unknown. ✓.

## The worker's Logger import — fine.

## Let me reconsider: should `anchorDocument` return 202 instead of 201 when the state is broadcast_unknown? The controller is a single endpoint; the status 201 (created) regardless of the broadcast outcome is fine — the anchor record is created. Let me keep 201.

## The response of issueVersion — StoredVersion includes `content` — echo the content back; fine.

## The API test's verify happy path: content is supplied via JSON body with a different key order (to prove canonicalization via HTTP). The verify body: `{ content: {...} }`.

Let me also confirm that the `@Body()` typing is loose: `body: { version?: unknown; content?: unknown }`. The express body is any → assignable. ✓.

## Prisma + `Prisma.AnchorUpdateManyMutationInput` import — from '@prisma/client'. ✓.

## The repository file imports AnchorStatus from '@prisma/client' — after `prisma generate`. In a fresh checkout, the build script runs prisma generate. The tests need the generated client — the user runs `pnpm prisma generate` (the build script does it). Note: the vitest run needs the generated client; the package.json script "test" doesn't generate... let me add a "pretest": "prisma generate" to package.json. A nice touch:
```json
"pretest": "prisma generate"
```
Vitest + the pretest npm hook works with pnpm? pnpm runs pre/post scripts — yes.

## Now, the number of files:

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/20250101000000_init/migration.sql
6. prisma/migrations/migration_lock.toml
7. docs/canonicalization.md
8. src/main.ts
9. src/app.module.ts
10. src/prisma/prisma.module.ts
11. src/prisma/prisma.service.ts
12. src/common/domain-exception.ts
13. src/common/all-exceptions.filter.ts
14. src/anchoring/anchoring.module.ts
15. src/anchoring/anchoring.controller.ts
16. src/anchoring/anchoring.service.ts
17. src/anchoring/anchoring.repository.ts
18. src/anchoring/anchoring.worker.ts
19. src/anchoring/anchoring.config.ts
20. src/anchoring/chain-client.ts
21. src/anchoring/in-memory-chain-client.ts
22. src/anchoring/canonicalize.ts
23. src/anchoring/content-diff.ts
24. src/anchoring/broadcast.ts
25. test/anchoring.spec.ts
26. test/anchoring.api.spec.ts

Let me now write each file fully and carefully, checking imports/types in my head.

### domain-exception.ts

```ts
/**
 * Domain errors with a stable `code` (the contract) and an HTTP status.
 * The global filter renders these as the single error envelope:
 *   { "error": { "code": "...", "message": "...", "details": {} } }
 */
export class DomainException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainException';
  }
}

export const validationError = (message: string, details: Record<string, unknown> = {}): DomainException =>
  new DomainException('validation_error', message, 400, details);

export const documentVersionNotFoundError = (documentId: string, version: number): DomainException =>
  new DomainException('document_version_not_found', `document ${documentId} version ${version} was not issued`, 404, { documentId, version });

export const documentVersionConflictError = (documentId: string, version: number): DomainException =>
  new DomainException('document_version_conflict', `document ${documentId} version ${version} was already issued`, 409, { documentId, version });

export const anchorNotFoundError = (documentId: string, version: number): DomainException =>
  new DomainException('anchor_not_found', `no anchor exists for document ${documentId} version ${version}`, 404, { documentId, version });

export const anchorConflictError = (documentId: string, version: number): DomainException =>
  new DomainException('anchor_conflict', `an anchor already exists for document ${documentId} version ${version}`, 409, { documentId, version });

export const invalidAnchorContentError = (reason: string): DomainException =>
  new DomainException('invalid_anchor_content', `report content cannot be anchored: ${reason}`, 422, { reason });
```

### all-exceptions.filter.ts

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * The single error envelope for the whole API:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `code` is the contract; `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainException) {
      return {
        status: exception.httpStatus,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const err = (payload as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
        if (err && typeof err.code === 'string') {
          return {
            status,
            body: {
              error: {
                code: err.code,
                message: typeof err.message === 'string' ? err.message : exception.message,
                details: (err.details as Record<string, unknown> | undefined) ?? {},
              },
            },
          };
        }
      }
      const code =
        status === 400 ? 'validation_error'
        : status === 404 ? 'not_found'
        : status === 409 ? 'conflict'
        : status === 422 ? 'unprocessable_content'
        : 'http_error';
      return { status, body: { error: { code, message: exception.message, details: {} } } };
    }
    return { status: 500, body: { error: { code: 'internal_error', message: 'internal server error', details: {} } } };
  }
}
```

`host.switchToHttp().getResponse()` — returns any (the Express response) — `.status().json()` OK. TS: getResponse() is typed as `any`? In Nest's types, `getResponse<T = any>()`? It's `getResponse(): any`. Fine.

### prisma.service.ts / prisma.module.ts

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

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### chain-client.ts

As above.

### in-memory-chain-client.ts

As above, plus a note about the shared state.

### canonicalize.ts

As above.

### content-diff.ts

As above. Let me refine the primitiveEqual:

```ts
function leavesDiffer(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' || typeof b === 'object') return true; // mixed shapes differ (object vs primitive/null)
  return a !== b;
}
```
Note: null is typeof 'object' — the mixed case is handled; two nulls: `a !== b` is false → equal, but the typeof check: both are objects → returns true → incorrectly different! Fix:
```ts
function leavesDiffer(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a !== b; // null is only equal to null
  if (typeof a === 'object' || typeof b === 'object') return true;
  return a !== b;
}
```
Both null → a!==b is false → equal ✓. null vs 5 → true ✓. object vs object (mixed with array) → the array/object case is handled earlier; an object that reaches here is mixed (object vs primitive) → different ✓.

### broadcast.ts

As above.

### anchoring.config.ts

As above.

### anchoring.repository.ts

Let me write it in full:

```ts
import { Injectable } from '@nestjs/common';
import { AnchorStatus, Prisma, PrismaClientKnownRequestError } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { anchorConflictError, documentVersionConflictError } from '../common/domain-exception.js';

/** Anchor lifecycle states (see the schema enum; DB values are snake_case). */
export type AnchorState = 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed';

export interface ChainReceiptRecord {
  txId: string;
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface StoredVersion {
  id: string;
  documentId: string;
  version: number;
  content: unknown;
  createdAt: Date;
}

export interface StoredAnchor {
  id: string;
  documentId: string;
  version: number;
  status: AnchorState;
  contentHash: string;
  txId: string;
  signedTx: string;
  blockNumber: number | null;
  receipt: ChainReceiptRecord | null;
  broadcastAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const TO_DB: Record<AnchorState, AnchorStatus> = {
  prepared: AnchorStatus.PREPARED,
  broadcast_sent: AnchorStatus.BROADCAST_SENT,
  broadcast_unknown: AnchorStatus.BROADCAST_UNKNOWN,
  confirmed: AnchorStatus.CONFIRMED,
  failed: AnchorStatus.FAILED,
};

const TO_STATE: Record<AnchorStatus, AnchorState> = {
  [AnchorStatus.PREPARED]: 'prepared',
  [AnchorStatus.BROADCAST_SENT]: 'broadcast_sent',
  [AnchorStatus.BROADCAST_UNKNOWN]: 'broadcast_unknown',
  [AnchorStatus.CONFIRMED]: 'confirmed',
  [AnchorStatus.FAILED]: 'failed',
};

type AnchorRow = Prisma.AnchorGetPayload<{}>;

function toStoredAnchor(row: AnchorRow): StoredAnchor {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    status: TO_STATE[row.status],
    contentHash: row.contentHash,
    txId: row.txId,
    signedTx: row.signedTx,
    blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),
    receipt: (row.receipt ?? null) as ChainReceiptRecord | null,
    broadcastAttempts: row.broadcastAttempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * The only layer that touches the database. All Prisma calls live here.
 */
@Injectable()
export class AnchoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVersion(documentId: string, version: number): Promise<StoredVersion | null> {
    const row = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    if (!row) return null;
    return { id: row.id, documentId: row.documentId, version: row.version, content: row.content, createdAt: row.createdAt };
  }

  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.document.upsert({ where: { id: documentId }, update: {}, create: { id: documentId } });
        await tx.documentVersion.create({ data: { documentId, version, content: content as Prisma.InputJsonValue } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw documentVersionConflictError(documentId, version);
      throw error;
    }
    const created = await this.findVersion(documentId, version);
    // Unreachable unless the transaction lied; keep the type honest.
    if (!created) throw new Error('createVersion: version row missing after commit');
    return created;
  }

  async createAnchor(data: { documentId: string; version: number; contentHash: string; txId: string; signedTx: string }): Promise<StoredAnchor> {
    try {
      const row = await this.prisma.anchor.create({ data: { ...data, status: AnchorStatus.PREPARED } });
      return toStoredAnchor(row);
    } catch (error) {
      // One anchor per (document, version): the unique constraint is the enforcement.
      if (isUniqueViolation(error)) throw anchorConflictError(data.documentId, data.version);
      throw error;
    }
  }

  async findAnchor(documentId: string, version: number): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? toStoredAnchor(row) : null;
  }

  async findById(id: string): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({ where: { id } });
    return row ? toStoredAnchor(row) : null;
  }

  async listByStatuses(states: AnchorState[], limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  async listStuck(states: AnchorState[], stuckBefore: Date, limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) }, updatedAt: { lt: stuckBefore } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  /**
   * Atomic compare-and-set transition: only succeeds if the row is still in
   * one of `from` states. Returns false when a concurrent worker already moved it.
   */
  async transition(
    id: string,
    from: AnchorState[],
    to: AnchorState,
    extra: { blockNumber?: number; receipt?: ChainReceiptRecord; incrementBroadcastAttempts?: boolean } = {},
  ): Promise<boolean> {
    const data: Prisma.AnchorUpdateManyMutationInput = { status: TO_DB[to] };
    if (extra.blockNumber !== undefined) data.blockNumber = BigInt(extra.blockNumber);
    if (extra.receipt !== undefined) data.receipt = extra.receipt as Prisma.InputJsonValue;
    if (extra.incrementBroadcastAttempts) data.broadcastAttempts = { increment: 1 };
    const result = await this.prisma.anchor.updateMany({
      where: { id, status: { in: from.map((s) => TO_DB[s]) } },
      data,
    });
    return result.count > 0;
  }
}
```

Wait — blockNumber is BigInt in the schema → the input for data.blockNumber is a BigInt. `BigInt(extra.blockNumber)`. ✓.

`Prisma.AnchorGetPayload<{}>` — a valid type. ✓.

The TO_STATE Record with computed keys `[AnchorStatus.PREPARED]` — AnchorStatus is a TS enum (const object) — computed keys work. ✓.

### anchoring.service.ts

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository, type StoredAnchor, type StoredVersion } from './anchoring.repository.js';
import { canonicalHash } from './canonicalize.js';
import { diffJson, type ContentDifference } from './content-diff.js';
import { attemptBroadcast } from './broadcast.js';
import {
  anchorNotFoundError,
  documentVersionNotFoundError,
  invalidAnchorContentError,
  type AnchorState? no — the AnchorState type from the repository.
} from '../common/domain-exception.js';
import type { AnchorState } from './anchoring.repository.js';

export interface AnchorProof {
  txId: string;
  blockNumber: number;
  blockHash: string;
}

export interface VerificationReport {
  documentId: string;
  version: number;
  storedContentHash: string;
  suppliedContentHash: string;
  match: boolean;
  /** The anchor's lifecycle state (see AnchorState). */
  anchorState: AnchorState;
  /** Present only when the supplied content matches AND the anchor is confirmed. */
  proof: AnchorProof | null;
  /** Populated only when the content does not match. */
  differences: ContentDifference[];
}

@Injectable()
export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  /** Issue a new report version (the structured JSON is the source of truth). */
  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    this.assertCanonicalizable(content);
    return this.repo.createVersion(documentId, version, content);
  }

  /**
   * Anchor a published report version on the L2.
   * Order matters and is the incident fix:
   *   1. canonical hash of the structured content
   *   2. prepare() — the tx identity exists now, before any broadcast
   *   3. persist the anchor intent (with the tx identity) and commit  ← write-ahead
   *   4. broadcast
   * Confirmation is a separate concern: a receipt, via the worker/sweep.
   */
  async anchorDocument(documentId: string, version: number): Promise<StoredAnchor> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const contentHash = this.canonicalHashOrThrow(versionRow.content);

    const prepared = this.chain.prepare({ documentId, version, contentHash });

    // Write-ahead: this commit is what lets recovery ask the chain about the
    // tx if the process dies at any point from here on.
    const anchor = await this.repo.createAnchor({
      documentId,
      version,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
    });

    // Only now do we broadcast. Its return value tells us nothing about whether
    // the tx landed; the receipt is the only confirmation.
    const outcome = await attemptBroadcast(this.chain, anchor.signedTx, this.config.broadcastTimeoutMs);
    await this.repo.transition(anchor.id, ['prepared'], outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown', {
      incrementBroadcastAttempts: true,
    });

    return (await this.repo.findById(anchor.id)) ?? anchor;
  }

  /**
   * Recompute the hash from the supplied content and return either the
   * anchoring proof (txId, block) or a mismatch report that says what differs.
   */
  async verify(documentId: string, version: number, suppliedContent: unknown): Promise<VerificationReport> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const suppliedHash = this.canonicalHashOrThrow(suppliedContent);

    const anchor = await this.repo.findAnchor(documentId, version);
    if (!anchor) throw anchorNotFoundError(documentId, version);

    const match = suppliedHash === anchor.contentHash;
    const confirmed = anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt !== null;
    return {
      documentId,
      version,
      storedContentHash: anchor.contentHash,
      suppliedContentHash: suppliedHash,
      match,
      anchorState: anchor.status,
      proof: match && confirmed
        ? { txId: anchor.txId, blockNumber: anchor.blockNumber as number, blockHash: anchor.receipt as ChainReceiptRecord... }
```

Hmm — the receipt's type: the anchor.receipt is ChainReceiptRecord | null → after the null check, use `anchor.receipt!.blockHash`. Let me import the ChainReceiptRecord type from the repository. Or just index: `blockHash: (anchor.receipt as ChainReceiptRecord).blockHash`. Let me do:

```ts
const receipt = anchor.receipt;
proof: match && confirmed
  ? { txId: anchor.txId, blockNumber: anchor.blockNumber as number, blockHash: (receipt as ChainReceiptRecord).blockHash }
  : null,
```
The TS narrowing across object literals doesn't carry through → the cast is fine. Or restructure:

```ts
let proof: AnchorProof | null = null;
if (match && anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt) {
  proof = { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.receipt.blockHash };
}
```
The narrowing works here (a simple if with &&). Cleaner. Let me use that.

Private helpers:
```ts
private canonicalHashOrThrow(content: unknown): string {
  try {
    return canonicalHash(content);
  } catch (error) {
    throw invalidAnchorContentError(error instanceof Error ? error.message : String(error));
  }
}
private assertCanonicalizable(content: unknown): void {
  this.canonicalHashOrThrow(content);
}
```

### anchoring.worker.ts

```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';

const PAGE_SIZE = 100;
const LIMBO_STATES = ['prepared', 'broadcast_unknown'] as const;

/**
 * Confirmation worker + recovery sweep.
 *
 * - Confirmation: anchors in `broadcast_sent` are polled for a receipt and
 *   advanced to `confirmed`/`failed`. Confirmation always comes from a receipt,
 *   never from broadcast() returning.
 * - Recovery: anchors stuck in broadcast-limbo (`prepared`, `broadcast_unknown`)
 *   are resolved by querying the chain FIRST. If a receipt exists, the anchor
 *   is confirmed from it and the tx is never re-broadcast. Only when the chain
 *   has no trace is the SAME signed tx re-broadcast (never a new one, so a
 *   re-send cannot become a second anchor).
 */
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const ok = this.repo.transition(row.id, ['broadcast_sent'], receipt.status === 'success' ? 'confirmed' : 'failed', {
        blockNumber: receipt.blockNumber,
        receipt,
      });
      void ok; // false only when a concurrent pass already advanced the row
    }
  }

  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck([...LIMBO_STATES], stuckBefore, PAGE_SIZE);
    for (const row of rows) {
      // Ask the chain first: if the tx landed (e.g. despite a broadcast
      // timeout), confirm it from the receipt — no re-broadcast.
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        await this.repo.transition(row.id, [...LIMBO_STATES], receipt.status === 'success' ? 'confirmed' : 'failed', {
          blockNumber: receipt.blockNumber,
          receipt,
        });
        continue;
      }
      // No trace on chain: re-broadcast the same signed transaction.
      const outcome = await attemptBroadcast(this.chain, row.signedTx, this.config.broadcastTimeoutMs);
      await this.repo.transition(row.id, [...LIMBO_STATES], outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown', {
        incrementBroadcastAttempts: true,
      });
    }
  }
}
```

`[...LIMBO_STATES]` → a string[] vs AnchorState[] — LIMBO_STATES is a readonly tuple of literals; the spread gives a string[] of literals — assignable to AnchorState[]? `string[]` is not assignable; a spread of a `readonly ['prepared','broadcast_unknown']` gives `("prepared" | "broadcast_unknown")[]` ✓. Good, drop the `as const` spread issue — with as const the spread type is the literal union array ✓.

The Logger is unused? Let me use it: log on recovery:
`this.logger.log(`recovered anchor ${row.id} ...`)`. Add a log when a receipt is found and when a re-broadcast happens. Keep it small.

### anchoring.controller.ts

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { AnchoringService } from './anchoring.service.js';
import type { StoredAnchor } from './anchoring.repository.js';
import { validationError } from '../common/domain-exception.js';

@Controller('documents')
export class AnchoringController {
  constructor(private readonly anchoring: AnchoringService) {}

  /** Issue a new version of a report (structured JSON, the source of truth). */
  @Post(':documentId/versions')
  issueVersion(@Param('documentId') documentId: string, @Body() body: { version?: unknown; content?: unknown } = {}) {
    return this.anchoring.createVersion(this.requireDocumentId(documentId), this.requireVersion(body.version), this.requireContent(body.content));
  }

  /** Anchor a published version on the L2 (write-ahead intent, then broadcast). */
  @Post(':documentId/versions/:version/anchors')
  createAnchor(@Param('documentId') documentId: string, @Param('version') version: string) {
    const anchor = this.anchoring.anchorDocument(this.requireDocumentId(documentId), this.requireVersion(version));
    return anchor.then(({ signedTx: _signedTx, ...visible }) => visible);
  }
```

Hmm — the controller does a .then transformation... "no business logic" — stripping a field is presentation. But an async method is cleaner:

```ts
  @Post(':documentId/versions/:version/anchors')
  async createAnchor(@Param('documentId') documentId: string, @Param('version') version: string): Promise<Omit<StoredAnchor, 'signedTx'>> {
    const anchor = await this.anchoring.anchorDocument(this.requireDocumentId(documentId), this.requireVersion(version));
    const { signedTx: _signedTx, ...visible } = anchor;
    return visible;
  }
```

OK.

```ts
  /** Verify supplied content against the anchor: proof or mismatch report. */
  @Post(':documentId/versions/:version/anchors/verifications')
  @HttpCode(200)
  verify(@Param('documentId') documentId: string, @Param('version') version: string, @Body() body: { content?: unknown } = {}) {
    return this.anchoring.verify(this.requireDocumentId(documentId), this.requireVersion(version), body.content);
  }

  private requireDocumentId(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw validationError('documentId must be a non-empty string', { documentId: raw ?? null });
    }
    return raw;
  }

  private requireVersion(raw: unknown): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
      throw validationError('version must be a positive integer', { version: raw ?? null });
    }
    return version;
  }

  private requireContent(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw validationError('content must be a JSON object', {});
    }
    return raw as Record<string, unknown>;
  }
}
```

Note: the route param is a string anyway; the requireDocumentId on a string is fine.

Wait — a version "1.5"? Number("1.5")=1.5 is not an integer → rejected ✓. "0" → rejected ✓.

### anchoring.module.ts — as above.

### app.module.ts, main.ts — as above.

### schema.prisma — as above, with BigInt:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Document {
  id       String            @id @map("id")
  versions DocumentVersion[]

  @@map("documents")
}

model DocumentVersion {
  id         String   @id @default(uuid()) @map("id")
  documentId String   @map("document_id")
  version    Int
  content    Json
  createdAt  DateTime @default(now()) @map("created_at")
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, version])
  @@map("document_versions")
}

enum AnchorStatus {
  PREPARED          @map("prepared")
  BROADCAST_SENT    @map("broadcast_sent")
  BROADCAST_UNKNOWN @map("broadcast_unknown")
  CONFIRMED         @map("confirmed")
  FAILED            @map("failed")

  @@map("AnchorStatus")
}

model Anchor {
  id                String       @id @default(uuid()) @map("id")
  documentId        String       @map("document_id")
  version           Int
  contentHash       String       @map("content_hash")
  txId              String       @map("tx_id")
  signedTx          String       @map("signed_tx")
  status            AnchorStatus @default(PREPARED) @map("status")
  blockNumber       BigInt?      @map("block_number")
  receipt           Json?        @map("receipt")
  broadcastAttempts Int          @default(0) @map("broadcast_attempts")
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")

  @@unique([documentId, version])
  @@map("anchors")
}
```

### migration.sql

```sql
-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('prepared', 'broadcast_sent', 'broadcast_unknown', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL DEFAULT uuid(),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL DEFAULT uuid(),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'prepared',
    "block_number" BIGINT,
    "receipt" JSONB,
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### Now the main spec — let me write it fully.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnchoringRepository } from '../src/anchoring/anchoring.repository.js';
import { AnchoringService } from '../src/anchoring/anchoring.service.js';
import { AnchoringWorker } from '../src/anchoring/anchoring.worker.js';
import { InMemoryChainClient, InMemoryChainState } from '../src/anchoring/in-memory-chain-client.js';
import { canonicalHash, canonicalize } from '../src/anchoring/canonicalize.js';
import { DomainException } from '../src/common/domain-exception.js';
import type { AnchoringConfig } from '../src/anchoring/anchoring.config.js';
import type { StoredAnchor } from '../src/anchoring/anchoring.repository.js';

const CONFIG: AnchoringConfig = {
  broadcastTimeoutMs: 500,
  confirmationPollMs: 0, // the passes are driven explicitly in tests
  recoverySweepMs: 0,
  stuckAfterMs: 0, // every limbo row is "stuck" for the purposes of a test
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('report anchoring (behaviour against the chain-client interface)', () => {
  const prisma = new PrismaService();
  const chainState = new InMemoryChainState();
  let repo: AnchoringRepository;
  let chain: InMemoryChainClient;
  let service: AnchoringService;
  let worker: AnchoringWorker;

  /** A fresh app "process": new client over the same chain (the chain survives restarts). */
  function makeProcess() {
    const client = new InMemoryChainClient(chainState);
    const svc = new AnchoringService(repo, client, CONFIG);
    const wk = new AnchoringWorker(repo, client, CONFIG);
    return { client, service: svc, worker: wk };
  }

  async function issue(documentId: string, version: number, content: Record<string, unknown>): Promise<void> {
    await service.createVersion(documentId, version, content);
  }

  async function waitForAnchor(documentId: string, version: number, timeoutMs = 3000): Promise<StoredAnchor> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await repo.findAnchor(documentId, version);
      if (row) return row;
      if (Date.now() > deadline) throw new Error(`anchor row for ${documentId}#${version} did not appear`);
      await sleep(10);
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    repo = new AnchoringRepository(prisma);
    ({ client: undefined, service, worker } = makeProcess()); // hmm — awkward
  }, 60_000);
```

Cleaner: in beforeAll, `const p = makeProcess(); chain = p.client; service = p.service; worker = p.worker;`

  beforeEach: clean the table:
```ts
beforeEach(async () => {
  await prisma.anchor.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.document.deleteMany();
  ({ service, worker } = ... ) — I need a fresh chain per test (the behavior hook is per-instance). Let me recreate the process per test:
  const p = makeProcess();
  chain = p.client; service = p.service; worker = p.worker;
});
```

afterAll: `await prisma.$disconnect();`

Tests:

```ts
  it('commits the anchor intent — with the tx identity — before the broadcast returns', async () => {
    await issue('doc-wa', 1, { patient: 'anon-42', result: 'positive', score: 1.5 });

    let release!: () => void;
    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain has accepted the tx
      await new Promise<void>((resolve) => { release = resolve; }); // broadcast() does not return yet
    });

    const anchorCall = service.anchorDocument('doc-wa', 1);

    // While the broadcast is still in flight, the intent must already be
    // committed — with the tx identity a naive design would only write later.
    const inFlight = await waitForAnchor('doc-wa', 1);
    expect(inFlight.status).toBe('prepared');
    expect(inFlight.txId).toMatch(/^tx_/);
    expect(inFlight.signedTx).toBe(`signed:${inFlight.txId}`);

    release();
    const anchor = await anchorCall;
    expect(anchor.status).toBe('broadcast_sent');
    expect(anchor.txId).toBe(inFlight.txId);

    // The on-chain tx is exactly the one we persisted.
    const receipt = await chain.getReceipt(inFlight.txId);
    expect(receipt?.txId).toBe(inFlight.txId);
  });
```

Wait — release() resolves the broadcast → attemptBroadcast resolves 'sent' → the transition. But the race: the 500ms timeout vs the release — the release is at ~50ms → sent ✓.

```ts
  it('broadcast timeout that landed: recovery confirms from the receipt and does not re-broadcast', async () => {
    await issue('doc-to', 3, { a: 1 });

    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain accepted it
      await new Promise(() => {}); // ...and broadcast() never returns (timeout)
    });

    const anchor = await service.anchorDocument('doc-to', 3);
    expect(anchor.status).toBe('broadcast_unknown');
    expect(anchor.txId).toMatch(/^tx_/);

    const broadcastsBefore = chainState.broadcastLog.length; // 1
    await worker.runRecoveryPass(); // chain first: the receipt exists

    const recovered = await repo.findAnchor('doc-to', 3);
    expect(recovered?.status).toBe('confirmed');
    expect(recovered?.blockNumber).toBeTypeOf('number');
    expect(recovered?.txId).toBe(anchor.txId);
    expect(chainState.broadcastLog.length).toBe(broadcastsBefore); // no re-broadcast
    expect(await prisma.anchor.count({ where: { documentId: 'doc-to', version: 3 } })).toBe(1);
  });
```

Hmm — `recovered?.blockNumber` is a number (converted). ✓.

Wait — the hanging promise `new Promise(() => {})` — the broadcast promise never settles; attemptBroadcast's race times out at 500ms → unknown ✓. The raw promise has a .catch attached (no rejection) — fine.

```ts
  it('broadcast timeout that did not land: the same signed tx is re-broadcast, one anchor results', async () => {
    await issue('doc-nl', 1, { a: 1 });

    chain.setBroadcast(() => new Promise(() => {})); // hang, and nothing lands
    const anchor = await service.anchorDocument('doc-nl', 1);
    expect(anchor.status).toBe('broadcast_unknown');

    // The chain is back to normal for the recovery pass.
    chain.setBroadcast(null);

    await worker.runRecoveryPass(); // no receipt → re-broadcast the SAME signed tx
    const afterRebroadcast = await repo.findAnchor('doc-nl', 1);
    expect(afterRebroadcast?.status).toBe('broadcast_sent');
    expect(chainState.broadcastLog).toEqual([anchor.signedTx, anchor.signedTx]);

    await worker.runConfirmationPass();
    const confirmed = await repo.findAnchor('doc-nl', 1);
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.txId).toBe(anchor.txId);
    expect(await prisma.anchor.count({ where: { documentId: 'doc-nl', version: 1 } })).toBe(1);
  });
```

`chainState.broadcastLog` — the first broadcast (the hang) is logged, the second (the re-broadcast) is logged with the same signedTx. ✓ toEqual [signedTx, signedTx].

Wait — the first broadcast: the behavior `() => new Promise(() => {})` — but the logging happens in broadcast() before the behavior: `this.state.broadcastLog.push(signedTx)` then the behavior. ✓.

The re-broadcast: the behavior is null → lands → resolves → 'sent' ✓.

The confirmation pass: getReceipt → the receipt exists (landed by the default broadcast) → confirmed ✓.

```ts
  it('process crash between broadcast and confirmation: restart recovers exactly one anchor', async () => {
    await issue('doc-cr', 7, { b: [1, 2, 3] });

    // The chain accepts the tx, then the process dies before any post-broadcast
    // state write. A real SIGKILL would leave the row 'prepared'; this
    // simulation leaves it 'broadcast_unknown' — both are limbo states the
    // recovery sweep resolves by asking the chain first, using the write-ahead
    // tx identity.
    chain.setBroadcast((_signedTx, txId, state) => {
      state.land(txId);
      throw new Error('simulated process crash');
    });

    const anchor = await service.anchorDocument('doc-cr', 7);
    expect(anchor.status).toBe('broadcast_unknown');
    const txId = anchor.txId;

    // "Restart": new process state, same chain (the chain keeps the tx).
    const { service: restartedService, worker: restartedWorker } = makeProcess();
    void restartedService;
    await restartedWorker.runRecoveryPass();

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-cr', version: 7 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('CONFIRMED');
    expect(rows[0].txId).toBe(txId);
    expect(chainState.broadcastLog.length).toBe(1); // broadcast exactly once, in total
  });
```

`rows[0].status` — the raw prisma row → the TS enum value 'CONFIRMED'. ✓.

`void restartedService;` — an unused variable; instead, let me destructure only the worker: `const { worker: restartedWorker } = makeProcess();` ✓ cleaner.

```ts
  it('anchoring the same (document, version) twice is rejected by the database', async () => {
    await issue('doc-uq', 2, { x: true });

    const [first, second] = await Promise.allSettled([
      service.anchorDocument('doc-uq', 2),
      service.anchorDocument('doc-uq', 2),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(DomainException);
    expect((rejected[0].reason as DomainException).code).toBe('anchor_conflict');

    // And a third attempt, after the first is confirmed, is rejected the same way.
    await worker.runConfirmationPass();
    await expect(service.anchorDocument('doc-uq', 2)).rejects.toMatchObject({ code: 'anchor_conflict', httpStatus: 409 });

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-uq', version: 2 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].txId).toBeTruthy(); // one transaction identity, total
  });
```

The winner's broadcast: the default behavior lands → after the confirmation pass → confirmed. Then the third call is rejected. ✓.

Wait — the Promise.allSettled order: which one is fulfilled is non-deterministic; I only assert the count. ✓.

Hmm — one risk: both calls run concurrently; both findVersion (2 DB reads), both prepare, both createAnchor. The Prisma client's concurrent writes — the DB serializes; the second gets P2002. ✓.

But — a subtle failure mode: the loser's createAnchor throws P2002 → translated ✓. The winner's createAnchor succeeds; its broadcast lands. ✓.

```ts
  describe('verify', () => {
    it('returns the on-chain proof for matching content (key order does not matter)', async () => {
      const content = { report: { patient: 'anon-1', values: [1, 2.5, 'ok'] }, issued: '2025-01-01' };
      await issue('doc-vf', 5, content);
      await service.anchorDocument('doc-vf', 5);
      await worker.runConfirmationPass();

      const row = await repo.findAnchor('doc-vf', 5);
      expect(row?.status).toBe('confirmed');

      // Same content, different key order → same canonical hash.
      const report = await service.verify('doc-vf', 5, { issued: '2025-01-01', report: { values: [1, 2.5, 'ok'], patient: 'anon-1' } });
      expect(report.match).toBe(true);
      expect(report.differences).toEqual([]);
      expect(report.anchorState).toBe('confirmed');
      expect(report.proof).toEqual({ txId: row!.txId, blockNumber: row!.blockNumber, blockHash: row!.receipt!.blockHash });
    });
```

The non-null assertion `row!.receipt!.blockHash` — TS is fine (strict allows !). OK.

    it('returns a mismatch report that says what differs', async () => {
      const content = { patient: 'anon-9', labs: { hgb: 12.5, wbc: 6.1 }, flags: [] };
      await issue('doc-mm', 1, content);
      await service.anchorDocument('doc-mm', 1);
      await worker.runConfirmationPass();

      const tampered = { patient: 'ANON-9', labs: { hgb: 13.0, wbc: 6.1 }, flags: ['review'], extra: 1 };
      const report = await service.verify('doc-mm', 1, tampered);

      expect(report.match).toBe(false);
      expect(report.storedContentHash).not.toBe(report.suppliedContentHash);
      expect(report.proof).toBeNull(); // no proof is served for content that does not match

      const byPath = new Map(report.differences.map((d) => [d.path, d]));
      expect(byPath.get('$.patient')?.kind).toBe('value');
      expect(byPath.get('$.patient')?.stored).toBe('anon-9');
      expect(byPath.get('$.patient')?.supplied).toBe('ANON-9');
      expect(byPath.get('$.labs.hgb')?.kind).toBe('value');
      expect(byPath.get('$.labs.hgb')?.stored).toBe(12.5);
      expect(byPath.get('$.labs.hgb')?.supplied).toBe(13);
      expect(byPath.get('$.labs.wbc')).toBeUndefined(); // unchanged fields are not reported
      expect(byPath.get('$.flags[0]')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.supplied).toBe(1);
    });

13.0 in JSON → 13 (a JS number) ✓.

    it('reports a pending anchor (matching content, no block yet) and missing anchors/versions', async () => {
      chain.setBroadcast(() => new Promise(() => {})); // never confirms
      await issue('doc-pd', 1, { a: 1 });
      await service.anchorDocument('doc-pd', 1);
      const pending = await service.verify('doc-pd', 1, { a: 1 });
      expect(pending.match).toBe(true);
      expect(pending.anchorState).toBe('broadcast_unknown');
      expect(pending.proof).toBeNull();

      await expect(service.anchorDocument('ghost', 1)).rejects.toMatchObject({ code: 'document_version_not_found', httpStatus: 404 });
      await expect(service.verify('ghost', 1, { a: 1 })).rejects.toMatchObject({ code: 'document_version_not_found' });
      await issue('doc-na', 1, { a: 1 });
      await expect(service.verify('doc-na', 1, { a: 1 })).rejects.toMatchObject({ code: 'anchor_not_found', httpStatus: 404 });
    });
  });
```

Hmm — the `chain.setBroadcast(() => new Promise(() => {}))` in the last test — the subsequent anchorDocument in the same test ('doc-na' is only verify, no anchor) is fine. But this test creates a 'doc-pd' anchor and leaves it in the table — the beforeEach cleanup handles the next test. ✓.

    describe('canonicalization (per docs/canonicalization.md)', () => {
      it('is key-order insensitive, whitespace-agnostic and number-normalizing', () => {
        expect(canonicalize({ b: 1, a: { d: 2, c: [true, null] } })).toBe('{"a":{"c":[true,null],"d":2},"b":1}');
        expect(canonicalHash({ b: 1, a: { c: [true, null], d: 2 } })).toBe(canonicalHash({ a: { d: 2, c: [true, null] }, b: 1 }));
        expect(canonicalHash({ n: 1.10, m: 1e2 })).toBe(canonicalHash({ n: 1.1, m: 100 }));
        expect(canonicalHash({ s: 'x"y' })).toBe(canonicalHash({ s: 'x"y' })); // trivial
        expect(canonicalize({ s: 'x"y' })).toBe('{"s":"x\\"y"}');
        expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
      });

      it('rejects non-JSON values (non-finite numbers, undefined keys are dropped)', () => {
        expect(() => canonicalize({ bad: Number.NaN })).toThrow();
        expect(canonicalize({ a: 1, gone: undefined })).toBe('{"a":1}');
      });
    });

`canonicalize({a:1, gone: undefined})` → the key 'gone' is filtered (undefined) → `{"a":1}` ✓ per the documented rule.

The API spec — as sketched. Let me finalize:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AnchoringModule } from '../src/anchoring/anchoring.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

describe('anchoring HTTP API (error envelope + flow)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    // keep the background worker from interfering with these assertions
    process.env.ANCHORING_CONFIRMATION_POLL_MS = '3600000';
    process.env.ANCHORING_RECOVERY_SWEEP_MS = '3600000';
    process.env.ANCHORING_STUCK_AFTER_MS = '3600000';

    const moduleRef = await Test.createTestingModule({ imports: [AnchoringModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    base = app.getUrl();

    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
  }, 60_000);

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await app.close();
  });

  it('rejects a malformed version with the standard 400 envelope', async () => {
    const res = await fetch(`${base}/documents/doc-x/versions/not-an-int/anchors`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('validation_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual(expect.any(Object));
    expect(body.error.details.version).toBe('not-an-int');
  });

  it('reports a document version that was never issued with 404', async () => {
    const res = await fetch(`${base}/documents/ghost-doc/versions/1/anchors`, { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('document_version_not_found');
    expect(body.error.details).toMatchObject({ documentId: 'ghost-doc', version: 1 });
  });

  it('issues a version, anchors it, verifies a mismatch — all through the API', async () => {
    const content = { patient: 'anon-7', labs: { hgb: 12.5 } };

    const issued = await fetch(`${base}/documents/doc-http/versions/1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, content }),
    });
    expect(issued.status).toBe(201);

    const anchored = await fetch(`${base}/documents/doc-http/versions/1/anchors`, { method: 'POST' });
    expect(anchored.status).toBe(201);
    const anchor = (await anchored.json()) as { documentId: string; version: number; status: string; txId: string; signedTx?: string };
    expect(anchor.documentId).toBe('doc-http');
    expect(anchor.version).toBe(1);
    expect(anchor.status).toBe('broadcast_sent');
    expect(anchor.txId).toMatch(/^tx_/);
    expect(anchor.signedTx).toBeUndefined(); // the signed tx is never exposed by the API

    const tampered = { patient: 'anon-7', labs: { hgb: 99.9 } };
    const verified = await fetch(`${base}/documents/doc-http/versions/1/anchors/verifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: tampered }),
    });
    expect(verified.status).toBe(200);
    const report = (await verified.json()) as { match: boolean; anchorState: string; differences: Array<{ path: string }>; proof: unknown };
    expect(report.match).toBe(false);
    expect(report.anchorState).toBe('broadcast_sent');
    expect(report.proof).toBeNull();
    expect(report.differences.map((d) => d.path)).toContain('$.labs.hgb');

    const reanchored = await fetch(`${base}/documents/doc-http/versions/1/anchors`, { method: 'POST' });
    expect(reanchored.status).toBe(409);
    const conflict = (await reanchored.json()) as ErrorEnvelope;
    expect(conflict.error.code).toBe('anchor_conflict');
  });
});
```

`fetch` — global in Node 20 ✓. TS's types for fetch: the lib needs to include DOM or @types/node ≥18 (Node 20 types include fetch via undici-types ✓ with `types: ["node"]`... the fetch global type comes from @types/node ≥ 18.0.0? Actually, the fetch global type was added to @types/node in v18? It's included via `undici-types` in recent @types/node (v20 ✓). But the tests aren't type-checked anyway (vitest uses esbuild, no type-check). And the tsconfig `lib: ["ES2022"]` has no DOM — the fetch typing for src is irrelevant (src doesn't use fetch). OK.

Now — `app.getUrl()` — exists on INestApplication ✓ (returns a string).

`await app.listen(0)` then getUrl — the URL is valid after listen. ✓.

One concern: `Test.createTestingModule` + `AnchoringModule` — the module's provider `InMemoryChainClient` factory `() => new InMemoryChainClient()` — a fresh state per app ✓.

The worker's interval: 1h → no interference. ✓.

PrismaService's onModuleInit connects during app.init ✓ (needs DATABASE_URL set — the test environment provides it; I'll note in the doc? The tests need a running Postgres with DATABASE_URL. That's the environment's responsibility per the convention.)

## Now — a potential Prisma + ESM gotcha: `import { PrismaClient } from '@prisma/client'` — the generated client's default export vs named export: Prisma 5's @prisma/client re-exports named `PrismaClient`, `Prisma`, enums ✓.

## The `@Inject(CHAIN_CLIENT)` in the service/worker — the module provides CHAIN_CLIENT ✓. In the direct-construction test, I pass it manually ✓ (no DI).

## The `AnchoringConfig` import in the worker — used only as a type + token.

## The `attemptBroadcast` import in the worker and service — from './broadcast.js' ✓.

## Let me double-check the `Prisma.AnchorUpdateManyMutationInput` — the correct type name for updateMany's data: `Prisma.AnchorUpdateManyMutationInput` ✓ (updateMany uses UpdateManyMutationInput).

## The `BigInt` conversion: `data.blockNumber = BigInt(extra.blockNumber)` — the input type is BigInt | null ✓.

## The repository's `createVersion` — the document's upsert + the version's create inside a $transaction — if the version is duplicated → P2002 from the version create inside the transaction → caught by the outer catch → documentVersionConflictError ✓ (the transaction rolls back).

## The unused variable `_signedTx` in the controller — strict but no noUnusedLocals ✓.

## The `NodeJS.Timeout` type in the worker — the @types/node global ✓ (src's tsconfig types: ["node"] ✓).

## The in-memory-chain-client's `setBroadcast` parameter type — a function returning a promise; the crash behavior returns void + throws — the type is `(signedTx, txId, state) => Promise<void>` — a function that throws synchronously is assignable (returns void → TS: is a function that returns void assignable to a function that returns Promise<void>? A function that returns void is NOT assignable to a function that returns Promise<void>... hmm. TS: `() => void` vs `() => Promise<void>` — the return type void is... assignability: a source returning void is not assignable to a target returning Promise<void> (void is a special case: only allowed when the target is void/any). So `setBroadcast((_s, txId, state) => { state.land(txId); throw ... })` — the inferred return is never (throw) → never is assignable to Promise<void> ✓. A function whose body throws has return type `never` → assignable ✓. The hang test's `async () => { ...; await new Promise(() => {}); }` → Promise<void> ✓. `() => new Promise(() => {})` → Promise<unknown> — assignable to Promise<void>? Promise<unknown> vs Promise<void>: void is special — Promise<unknown> is not assignable to Promise<void>? Actually, in function return positions, `Promise<unknown>` → `Promise<void>`: the void return type in function types accepts anything (a function returning X is assignable to a function returning void). But here it's a direct value type (a stored callback), not a function return position. `setBroadcast(fn)` where fn: `(...) => Promise<void>`; the argument `() => new Promise(() => {})` has type `() => Promise<unknown>` — the function-type assignability: the return Promise<unknown> must be assignable to Promise<void> — invariance in Promise<T> → not assignable! Hmm. But `new Promise(() => {})` — the Promise constructor: `new Promise<void>(...)`? `new Promise(() => {})` infers `Promise<unknown>`. To be safe, type the hook as `(...args) => Promise<void> | void`? Or in the test, annotate: `() => new Promise<void>(() => {})`. Let me do that in the tests. And the signature: `setBroadcast(behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null)`. The tests use `async () => {...}` (Promise<void> ✓) and `() => new Promise<void>(() => {})` ✓ and the crash arrow (never ✓).

Inside broadcast(): `if (this.behavior) await this.behavior(...)` ✓.

## The `InMemoryChainState.land` default parameter `status = 'success'` ✓.

## The `broadcastLog` includes the crash broadcast ✓ (pushed before the behavior).

## Let me re-verify the acceptance mapping:

- "an intent including tx identity is committed before broadcast() is called" → test 1 ✓ + code order ✓.
- "broadcast times out but landed → recovery confirms from the receipt, no re-broadcast" → test 2 ✓.
- "broadcast times out and did not land → same signed tx re-broadcast, one anchor" → test 3 ✓.
- "a crash between broadcast and confirmation → restart recovers, one anchor total" → test 4 ✓.
- "anchoring the same (document, version) twice → rejected by the database" → test 5 ✓ (the P2002 translation proves the DB rejection; the unique index is in the migration/schema).
- "verify returns a proof for matching content, a mismatch report otherwise" → test 6 ✓.
- "documented canonicalization" → docs/canonicalization.md + the spec's test ✓.
- "a confirmation worker polling receipts and advancing state" → AnchoringWorker.runConfirmationPass + the interval ✓.
- "a recovery sweep that queries the chain first" → runRecoveryPass ✓.

## Deliverable "Prisma schema with the uniqueness constraint" ✓.

Now, let me reconsider whether `version` should be an `Int` in the API — the route param is a string, validated. ✓.

## One more: the task's function names `anchorDocument(documentId, version)` ✓ and `verify(documentId, version, content)` ✓ (my service methods: anchorDocument(documentId, version), verify(documentId, version, suppliedContent) ✓).

## File: `src/anchoring/anchoring.config.ts` — exports ANCHORING_CONFIG + AnchoringConfig + anchoringConfigFromEnv.

Let me double-check the module's provider: `{ provide: ANCHORING_CONFIG, useFactory: anchoringConfigFromEnv }` — a factory with no inject ✓.

## main.ts's port: `Number(process.env.PORT ?? 3000)`.

## package.json — final:

```json
{
  "name": "report-anchoring",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "pretest": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@prisma/client": "^5.18.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.18.0",
    "tsx": "^4.17.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

vitest 2 — fine.

## The vitest.config.ts:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

## The tsconfig — rootDir src; the tests are outside → tsc only builds src ✓ (the tests run via vitest).

Wait — the outDir dist: `node dist/main.js` — the relative imports in dist keep the .js extension ✓.

## Let me re-check the ESM import extensions in every src file:

- main.ts: './app.module.js', './common/all-exceptions.filter.js' ✓
- app.module.ts: './anchoring/anchoring.module.js' ✓
- anchoring.module.ts: '../prisma/prisma.module.js', './anchoring.controller.js', './anchoring.service.js', './anchoring.repository.js', './anchoring.worker.js', './chain-client.js', './in-memory-chain-client.js', './anchoring.config.js' ✓
- anchoring.controller.ts: './anchoring.service.js', './anchoring.repository.js' (type), '../common/domain-exception.js' ✓
- anchoring.service.ts: './anchoring.config.js', './chain-client.js', './anchoring.repository.js', './canonicalize.js', './content-diff.js', './broadcast.js', '../common/domain-exception.js' ✓
- anchoring.repository.ts: '@prisma/client', '../prisma/prisma.service.js', '../common/domain-exception.js' ✓
- anchoring.worker.ts: './anchoring.config.js', './chain-client.js', './anchoring.repository.js', './broadcast.js' ✓
- broadcast.ts: './chain-client.js' ✓
- in-memory-chain-client.ts: 'node:crypto', './chain-client.js' ✓
- canonicalize.ts: 'node:crypto' ✓
- prisma.service.ts: '@prisma/client' ✓
- filter: './domain-exception.js' ✓

The test imports: '../src/...' with .js ✓.

## The `PrismaService` manual instantiation in the spec: `new PrismaService()` — PrismaClient's constructor with no args → reads DATABASE_URL from the env ✓. `await prisma.$connect()` ✓. Note: PrismaService implements OnModuleInit but I call $connect manually ✓.

## A potential issue: two spec files each instantiate PrismaClient + the API module's PrismaService — three clients across the specs — vitest runs the test files in separate workers (default: per-file isolation) → the DB connection is independent, fine. Within a file, sequential.

But — both specs clean the same table in parallel? Vitest's default: files run in parallel (separate workers). The two specs both deleteMany + insert with different document ids (doc-wa..., doc-http...) — the parallel cleanup could race (spec A deletes while spec B inserts). That's flaky! Mitigation: make vitest run files sequentially: `fileParallelism: false` (vitest 2: `fileParallelism: false`? the option is `fileParallelism` in vitest 2, formerly `threads`/`singleThread`). Let me set:

```ts
test: {
  environment: 'node',
  include: ['test/**/*.spec.ts'],
  fileParallelism: false,
  testTimeout: 30_000,
  hookTimeout: 60_000,
}
```
Vitest 2.x supports `fileParallelism: false` ✓. That serializes the files → no cross-file DB race.

## Also the API spec sets the process.env values — with fileParallelism false and separate workers (separate processes? by default each file gets its own worker thread — the env is per-worker) — the env set in the API spec's beforeAll affects only that worker ✓.

## Now — let me reconsider `waitForAnchor` in the write-ahead test: the service's anchorDocument is running; the createAnchor happens after the findVersion. The poll starts immediately; it catches the row within ~1-2 polls. At that moment, the status must be 'prepared' — the transition to broadcast_sent happens only after the release (500ms timeout or the release). The release is after the waitForAnchor returns. So the status is 'prepared' ✓ deterministic (no timeout race since 500ms > the poll window).

## The crash test: `chain.setBroadcast((_signedTx, txId, state) => { state.land(txId); throw new Error(...); })` — the parameter type `(signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>`; this arrow returns never → assignable ✓. The `_signedTx` is an unused parameter — the strict noUnusedParameters is off ✓.

## The `makeProcess` in the crash test creates a worker with the CONFIG (stuckAfter 0) ✓.

## Let me check `rows[0].status` — `prisma.anchor.findMany` returns the Anchor model with status: AnchorStatus (a TS enum). `toBe('CONFIRMED')` — the enum value string ✓.

## The API test's `expect(anchor.signedTx).toBeUndefined()` — the controller strips it ✓.

## The verify response's `differences` for the HTTP mismatch: `$.labs.hgb` ✓ (patient is the same, only hgb is changed).

Wait — content = { patient: 'anon-7', labs: { hgb: 12.5 } }; tampered = { patient: 'anon-7', labs: { hgb: 99.9 } } → the only diff is $.labs.hgb ✓.

## The mismatch report's `proof` is null ✓ per the design.

## Now, is `report.anchorState` = 'broadcast_sent' in the HTTP test? The default chain lands immediately, but the worker is quiet (1h) → the state stays broadcast_sent ✓ deterministic.

## The issue endpoint: the version is created with content; the response is 201 with the StoredVersion — `expect(issued.status).toBe(201)` ✓.

## Potential gotcha: Nest's default for `@Post` is 201 ✓.

## The body `{ version: 1, content }` — requireVersion(body.version) ✓.

## Now, let me write the final content of the canonicalization doc, avoiding the triple-backtick fences:

Use indentation (4 spaces) for the example. And an inline code with a single backtick.

Also mention: "the hash is stored in `anchors.content_hash`, and the on-chain payload is `{documentId, version, contentHash}` — wait, the tx data in my fake is the prepare input. Let me document: the on-chain payload carried by the prepared tx is the triple (documentId, version, contentHash); the chain identity (txId) is derived deterministically by the client's prepare. For a real client, the payload would be the content hash (optionally with the document coordinates). Let me keep the doc focused on the content canonicalization (the deliverable) and not overspecify the tx payload.

## Reconsider `canonicalize` for the `1e2` example in the doc: JSON.stringify(1e2) = "100" ✓; 1e21 → "1e+21" ✓.

## Edge: a string containing a surrogate pair — JSON.stringify escapes it as a \u pair; the doc says "control characters are escaped; other Unicode passes through" — non-BMP passes through as the surrogate pair characters (JSON.stringify does NOT escape them). Let me phrase: "quotes, backslashes, and control characters are escaped per JSON.stringify; all other code points pass through unchanged." ✓ accurate.

## The doc's "reproduction" references the file ✓.

## Now — the "no tools" constraint means I deliver the files only. The format: each file: `### path` + a fenced block. The first line is the first heading. Nothing else. Let me now compose all files in full.

Order:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20250101000000_init/migration.sql
7. docs/canonicalization.md
8. src/main.ts
9. src/app.module.ts
10. src/prisma/prisma.module.ts
11. src/prisma/prisma.service.ts
12. src/common/domain-exception.ts
13. src/common/all-exceptions.filter.ts
14. src/anchoring/anchoring.config.ts
15. src/anchoring/chain-client.ts
16. src/anchoring/in-memory-chain-client.ts
17. src/anchoring/canonicalize.ts
18. src/anchoring/content-diff.ts
19. src/anchoring/broadcast.ts
20. src/anchoring/anchoring.repository.ts
21. src/anchoring/anchoring.service.ts
22. src/anchoring/anchoring.worker.ts
23. src/anchoring/anchoring.controller.ts
24. src/anchoring/anchoring.module.ts
25. test/anchoring.spec.ts
26. test/anchoring.api.spec.ts

Let me now write the final code for each file, checking imports/types in my head.

**package.json** — as above.

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

**vitest.config.ts**:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

**prisma/schema.prisma** — as above.

**migration_lock.toml**:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git or svn)
provider = "postgresql"
```

**migration.sql** — as above.

**docs/canonicalization.md**:

```md
# Canonicalization of report content

The structured JSON of an issued report version is the source of truth. The PDF
is a rendering of that JSON and is never part of the hash. An anchor is
`SHA-256(canonical_bytes)` where `canonical_bytes` is the UTF-8 encoding of the
canonical serialization below, written as 64 lowercase hex characters.

## Canonical serialization rules

Input: the parsed JSON value of the stored report version (a JSON object).

1. Objects
   - Keys are sorted lexicographically in UTF-16 code unit order (the default
     JavaScript `Array.prototype.sort` on strings) and emitted in that order.
   - A key whose value is `undefined` is omitted entirely (JSON.stringify
     semantics). After `JSON.parse` this cannot occur, so stored and supplied
     content behave identically.
   - Emitted compactly: `{"k1":v1,"k2":v2}` — no whitespace between tokens.
2. Arrays
   - Element order is significant and preserved: `[e1,e2,...]`.
3. Strings
   - Emitted with `JSON.stringify` escaping: quotes, backslashes and control
     characters are escaped; all other code points pass through unchanged.
4. Numbers
   - Emitted as the shortest decimal string that round-trips to the same
     IEEE-754 double — exactly what `JSON.stringify` produces (`12.5`, `100`,
     `1e+21`). Consequently `1.10` and `1.1` canonicalize identically, as do
     `1e2` and `100`, and `-0` and `0`.
   - Non-finite values (NaN, +/-Infinity) are not representable in JSON and are
     rejected, not hashed.
5. Booleans and null
   - The literals `true`, `false`, `null`.
6. Anything else
   - Any other JavaScript type (function, symbol, bigint, ...) is rejected.

## Worked example

    input:      { "b": 1, "a": { "d": 2, "c": [true, null] } }
    canonical:  {"a":{"c":[true,null],"d":2},"b":1}
    hash:       sha256(UTF-8(canonical)) in lowercase hex

## What does not affect the hash

- Key insertion order of objects.
- Whitespace and formatting of the original JSON text.
- Numeric notation that denotes the same double (`1.10` is `1.1`).
- The PDF rendering, file names, and any rendering metadata.

## Reproduction

An auditor recomputes the hash from the stored (or supplied) content as:
parse JSON, apply the rules above, UTF-8 encode, SHA-256, lowercase hex.
Reference implementation: `src/anchoring/canonicalize.ts`
(`canonicalize` and `canonicalHash`).
```

**src/main.ts**:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

**src/app.module.ts**:

```ts
import { Module } from '@nestjs/common';
import { AnchoringModule } from './anchoring/anchoring.module.js';

@Module({
  imports: [AnchoringModule],
})
export class AppModule {}
```

**src/prisma/prisma.service.ts** and **prisma.module.ts** — as above.

**src/common/domain-exception.ts** — as above.

**src/common/all-exceptions.filter.ts** — as above.

**src/anchoring/anchoring.config.ts**:

```ts
/** Runtime configuration, from environment variables only. */
export interface AnchoringConfig {
  /** Give up waiting for broadcast() after this long; the outcome is then unknown. */
  broadcastTimeoutMs: number;
  /** How often the confirmation worker polls receipts (0 disables the timer). */
  confirmationPollMs: number;
  /** How often the recovery sweep runs (0 disables the timer). */
  recoverySweepMs: number;
  /** A limbo row must be at least this old before the sweep touches it, so the sweep never races in-flight work. */
  stuckAfterMs: number;
}

export const ANCHORING_CONFIG = 'ANCHORING_CONFIG';

function nonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function anchoringConfigFromEnv(): AnchoringConfig {
  return {
    broadcastTimeoutMs: nonNegativeInt('BROADCAST_TIMEOUT_MS', 30_000),
    confirmationPollMs: nonNegativeInt('ANCHORING_CONFIRMATION_POLL_MS', 5_000),
    recoverySweepMs: nonNegativeInt('ANCHORING_RECOVERY_SWEEP_MS', 60_000),
    stuckAfterMs: nonNegativeInt('ANCHORING_STUCK_AFTER_MS', 60_000),
  };
}
```

**src/anchoring/chain-client.ts**:

```ts
/**
 * The chain-client contract (no real keys, no RPC — code against this
 * interface; tests and the local default use an in-memory implementation):
 *
 *   prepare(tx)         -> { txId, signedTx }   local, deterministic
 *   broadcast(signedTx) -> Promise<void>        may time out, outcome unknown
 *   getReceipt(txId)    -> Promise<Receipt>     the receipt once included, else null
 *
 * Key property: `prepare` is local, so the transaction identity exists BEFORE
 * any broadcast. Confirmation always comes from `getReceipt`, never from
 * `broadcast()` returning.
 */

export interface ChainTxInput {
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
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface ChainClient {
  prepare(tx: ChainTxInput): PreparedTx;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

export const CHAIN_CLIENT = 'CHAIN_CLIENT';
```

**src/anchoring/in-memory-chain-client.ts**:

```ts
import { createHash } from 'node:crypto';
import type { ChainClient, ChainReceipt, ChainTxInput, PreparedTx } from './chain-client.js';

/**
 * The "chain" side of the fake: state a real L2 would keep regardless of our
 * process (accepted txs, receipts, block numbers). Sharing one instance across
 * two InMemoryChainClient instances simulates a process restart: the app state
 * is gone, the chain is not.
 */
export class InMemoryChainState {
  readonly receipts = new Map<string, ChainReceipt>();
  /** Every signed tx the chain has accepted, in order (duplicates included). */
  readonly broadcastLog: string[] = [];
  private nextBlock = 1;

  land(txId: string, status: 'success' | 'failure' = 'success'): void {
    if (this.receipts.has(txId)) return; // the chain deduplicates by tx identity
    this.receipts.set(txId, {
      txId,
      blockNumber: this.nextBlock++,
      blockHash: `blk_${txId.slice(0, 16)}`,
      status,
    });
  }
}

/**
 * In-process ChainClient. It is the default provider because the task scopes
 * out real keys/RPC, and it doubles as the fake for tests (via `setBroadcast`
 * to simulate timeouts, crashes, and non-landing).
 */
export class InMemoryChainClient implements ChainClient {
  private readonly txIds = new Map<string, string>();
  private behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null = null;

  constructor(readonly state: InMemoryChainState = new InMemoryChainState()) {}

  prepare(tx: ChainTxInput): PreparedTx {
    const digest = createHash('sha256').update(`${tx.documentId}|${tx.version}|${tx.contentHash}`).digest('hex');
    const txId = `tx_${digest.slice(0, 40)}`;
    const signedTx = `signed:${txId}`;
    this.txIds.set(signedTx, txId);
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = this.txIds.get(signedTx) ?? `tx_${createHash('sha256').update(signedTx).digest('hex').slice(0, 40)}`;
    this.state.broadcastLog.push(signedTx);
    if (this.behavior) {
      await this.behavior(signedTx, txId, this.state);
    } else {
      this.state.land(txId);
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.state.receipts.get(txId) ?? null;
  }

  /** Test hook: override the broadcast behavior. null restores the default (accept and land). */
  setBroadcast(behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null): void {
    this.behavior = behavior;
  }
}
```

**src/anchoring/canonicalize.ts**:

```ts
import { createHash } from 'node:crypto';

/**
 * Canonical serialization of report content — the written spec is
 * docs/canonicalization.md; this is the reference implementation an auditor
 * can diff against.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`non-finite number cannot be canonically serialized: ${value}`);
      }
      // Shortest round-trip decimal representation (JSON.stringify semantics).
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      // Keys sorted lexicographically (UTF-16 code unit order); undefined values omitted.
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
    }
    default:
      throw new Error(`unsupported value type in report content: ${typeof value}`);
  }
}

/** SHA-256 of the canonical UTF-8 bytes, 64 lowercase hex characters. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
```

**src/anchoring/content-diff.ts**:

```ts
/**
 * Path-level differences between the stored report content and supplied
 * content. Only called when the canonical hashes differ, so at least one
 * difference is always produced.
 */
export interface ContentDifference {
  /** JSON path: `$`, `$.a.b`, `$.a[0].c`. */
  path: string;
  kind: 'value' | 'missing_in_supplied' | 'missing_in_stored';
  stored?: unknown;
  supplied?: unknown;
}

export function diffJson(stored: unknown, supplied: unknown): ContentDifference[] {
  const differences: ContentDifference[] = [];
  walk(stored, supplied, '$', differences);
  return differences;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(stored: unknown, supplied: unknown, path: string, out: ContentDifference[]): void {
  if (Array.isArray(stored) && Array.isArray(supplied)) {
    const shared = Math.min(stored.length, supplied.length);
    for (let i = 0; i < shared; i++) walk(stored[i], supplied[i], `${path}[${i}]`, out);
    for (let i = shared; i < stored.length; i++) out.push({ path: `${path}[${i}]`, kind: 'missing_in_supplied', stored: stored[i] });
    for (let i = shared; i < supplied.length; i++) out.push({ path: `${path}[${i}]`, kind: 'missing_in_stored', supplied: supplied[i] });
    return;
  }
  if (isPlainObject(stored) && isPlainObject(supplied)) {
    const keys = Array.from(new Set([...Object.keys(stored), ...Object.keys(supplied)])).sort();
    for (const key of keys) {
      const child = `${path}.${key}`;
      if (!(key in stored)) out.push({ path: child, kind: 'missing_in_stored', supplied: supplied[key] });
      else if (!(key in supplied)) out.push({ path: child, kind: 'missing_in_supplied', stored: stored[key] });
      else walk(stored[key], supplied[key], child, out);
    }
    return;
  }
  if (leavesDiffer(stored, supplied)) out.push({ path, kind: 'value', stored, supplied });
}

function leavesDiffer(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a !== b;
  if (typeof a === 'object' || typeof b === 'object') return true; // mixed shapes (object vs primitive)
  return a !== b;
}
```

**src/anchoring/broadcast.ts**:

```ts
import type { ChainClient } from './chain-client.js';

/**
 * Broadcast with a bounded wait. A successful return means "accepted for
 * broadcast" only — confirmation comes from a receipt, never from here.
 * A timeout or rejection means the outcome is UNKNOWN: the tx may or may not
 * have landed, and the recovery sweep will ask the chain.
 */
export async function attemptBroadcast(chain: ChainClient, signedTx: string, timeoutMs: number): Promise<'sent' | 'unknown'> {
  const broadcast = Promise.resolve().then(() => chain.broadcast(signedTx));
  // A late rejection (after we timed out) must not crash the process; the
  // state machine owns the outcome.
  broadcast.catch(() => undefined);
  try {
    await Promise.race([
      broadcast,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('broadcast timed out')), timeoutMs);
        timer.unref();
      }),
    ]);
    return 'sent';
  } catch {
    return 'unknown';
  }
}
```

**src/anchoring/anchoring.repository.ts** — as drafted. Let me finalize with the BigInt handling.

**src/anchoring/anchoring.service.ts** — as drafted; let me finalize with the proof construction:

```ts
    let proof: AnchorProof | null = null;
    if (match && anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt !== null) {
      proof = { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.receipt.blockHash };
    }
    return {
      documentId,
      version,
      storedContentHash: anchor.contentHash,
      suppliedContentHash: suppliedHash,
      match,
      anchorState: anchor.status,
      proof,
      differences: match ? [] : diffJson(versionRow.content, suppliedContent),
    };
```

The type of anchor.receipt: ChainReceiptRecord | null → after the !== null check, `.blockHash` ✓ (TS narrows within the if via &&? `anchor.receipt !== null` then `anchor.receipt.blockHash` — the narrowing works since anchor is const ✓).

**src/anchoring/anchoring.worker.ts** — as drafted, with logs.

**src/anchoring/anchoring.controller.ts** — as drafted.

**src/anchoring/anchoring.module.ts** — as drafted, with the ASSUMPTION comment.

**test/anchoring.spec.ts** — let me assemble the full file:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { AnchoringConfig } from '../src/anchoring/anchoring.config.js';
import { InMemoryChainClient, InMemoryChainState } from '../src/anchoring/in-memory-chain-client.js';
import { AnchoringRepository, type StoredAnchor } from '../src/anchoring/anchoring.repository.js';
import { AnchoringService } from '../src/anchoring/anchoring.service.js';
import { AnchoringWorker } from '../src/anchoring/anchoring.worker.js';
import { canonicalHash, canonicalize } from '../src/anchoring/canonicalize.js';
import { DomainException } from '../src/common/domain-exception.js';

const CONFIG: AnchoringConfig = {
  broadcastTimeoutMs: 500,
  confirmationPollMs: 0, // no background timers: the passes are driven explicitly
  recoverySweepMs: 0,
  stuckAfterMs: 0, // every limbo row counts as stuck for a test
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('report anchoring (behaviour against the chain-client interface)', () => {
  const prisma = new PrismaService();
  // The chain survives "process restarts"; app state does not.
  const chainState = new InMemoryChainState();
  let repo: AnchoringRepository;
  let chain: InMemoryChainClient;
  let service: AnchoringService;
  let worker: AnchoringWorker;

  /** A fresh app "process": new client/service/worker over the same chain. */
  function makeProcess(): { client: InMemoryChainClient; service: AnchoringService; worker: AnchoringWorker } {
    const client = new InMemoryChainClient(chainState);
    return { client, service: new AnchoringService(repo, client, CONFIG), worker: new AnchoringWorker(repo, client, CONFIG) };
  }

  async function issue(documentId: string, version: number, content: Record<string, unknown>): Promise<void> {
    await service.createVersion(documentId, version, content);
  }

  async function waitForAnchor(documentId: string, version: number, timeoutMs = 3000): Promise<StoredAnchor> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await repo.findAnchor(documentId, version);
      if (row) return row;
      if (Date.now() > deadline) throw new Error(`anchor row for ${documentId}#${version} did not appear`);
      await sleep(10);
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    repo = new AnchoringRepository(prisma);
  }, 60_000);

  beforeEach(async () => {
    const process = makeProcess();
    chain = process.client;
    service = process.service;
    worker = process.worker;
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('commits the anchor intent — with the tx identity — before the broadcast returns', async () => {
    await issue('doc-wa', 1, { patient: 'anon-42', result: 'positive', score: 1.5 });

    let release!: () => void;
    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain has accepted the tx
      await new Promise<void>((resolve) => { release = resolve; }); // ...but broadcast() does not return yet
    });

    const anchorCall = service.anchorDocument('doc-wa', 1);

    // While the broadcast is still in flight, the intent must already be
    // committed, with the tx identity a naive (persist-after-broadcast) design
    // would only write later.
    const inFlight = await waitForAnchor('doc-wa', 1);
    expect(inFlight.status).toBe('prepared');
    expect(inFlight.txId).toMatch(/^tx_/);
    expect(inFlight.signedTx).toBe(`signed:${inFlight.txId}`);

    release();
    const anchor = await anchorCall;
    expect(anchor.status).toBe('broadcast_sent');
    expect(anchor.txId).toBe(inFlight.txId);

    const receipt = await chain.getReceipt(inFlight.txId);
    expect(receipt?.txId).toBe(inFlight.txId); // the on-chain tx is the one we persisted
  });

  it('broadcast timeout that landed: recovery confirms from the receipt, no re-broadcast', async () => {
    await issue('doc-to', 3, { a: 1 });

    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain accepted it
      await new Promise<void>(() => {}); // ...and broadcast() never returns (timeout)
    });

    const anchor = await service.anchorDocument('doc-to', 3);
    expect(anchor.status).toBe('broadcast_unknown');
    expect(anchor.txId).toMatch(/^tx_/);

    const broadcastsBefore = chainState.broadcastLog.length; // exactly 1
    await worker.runRecoveryPass(); // chain first: the receipt already exists

    const recovered = await repo.findAnchor('doc-to', 3);
    expect(recovered?.status).toBe('confirmed');
    expect(recovered?.blockNumber).toBeTypeOf('number');
    expect(recovered?.txId).toBe(anchor.txId);
    expect(chainState.broadcastLog.length).toBe(broadcastsBefore); // no re-broadcast
    expect(await prisma.anchor.count({ where: { documentId: 'doc-to', version: 3 } })).toBe(1);
  });

  it('broadcast timeout that did not land: the same signed tx is re-broadcast, one anchor results', async () => {
    await issue('doc-nl', 1, { a: 1 });

    chain.setBroadcast(() => new Promise<void>(() => {})); // hang, and nothing lands
    const anchor = await service.anchorDocument('doc-nl', 1);
    expect(anchor.status).toBe('broadcast_unknown');

    chain.setBroadcast(null); // the chain is back to normal for the recovery pass

    await worker.runRecoveryPass(); // no receipt on chain -> re-broadcast the SAME signed tx
    const afterRebroadcast = await repo.findAnchor('doc-nl', 1);
    expect(afterRebroadcast?.status).toBe('broadcast_sent');
    expect(chainState.broadcastLog).toEqual([anchor.signedTx, anchor.signedTx]);

    await worker.runConfirmationPass();
    const confirmed = await repo.findAnchor('doc-nl', 1);
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.txId).toBe(anchor.txId);
    expect(await prisma.anchor.count({ where: { documentId: 'doc-nl', version: 1 } })).toBe(1);
  });

  it('process crash between broadcast and confirmation: restart recovers exactly one anchor', async () => {
    await issue('doc-cr', 7, { b: [1, 2, 3] });

    // The chain accepts the tx, then the process dies before any post-broadcast
    // state write. A real SIGKILL would leave the row 'prepared'; this
    // simulation leaves it 'broadcast_unknown' — both are limbo states the
    // recovery sweep resolves by asking the chain first, using the write-ahead
    // tx identity that a persist-after-broadcast design would not have.
    chain.setBroadcast((_signedTx, txId, state) => {
      state.land(txId);
      throw new Error('simulated process crash');
    });

    const anchor = await service.anchorDocument('doc-cr', 7);
    expect(anchor.status).toBe('broadcast_unknown');
    const txId = anchor.txId;

    // "Restart": fresh process state, same chain (the chain keeps the tx).
    const { worker: restartedWorker } = makeProcess();
    await restartedWorker.runRecoveryPass();

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-cr', version: 7 } });
    expect(rows).toHaveLength(1); // one anchor, total
    expect(rows[0].status).toBe('CONFIRMED');
    expect(rows[0].txId).toBe(txId); // one transaction identity
    expect(chainState.broadcastLog.length).toBe(1); // broadcast exactly once, in total
  });

  it('anchoring the same (document, version) twice is rejected by the database', async () => {
    await issue('doc-uq', 2, { x: true });

    const [first, second] = await Promise.allSettled([
      service.anchorDocument('doc-uq', 2),
      service.anchorDocument('doc-uq', 2),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(DomainException);
    expect((rejected[0].reason as DomainException).code).toBe('anchor_conflict');

    // A third attempt, after the first is confirmed, is rejected the same way.
    await worker.runConfirmationPass();
    await expect(service.anchorDocument('doc-uq', 2)).rejects.toMatchObject({ code: 'anchor_conflict', httpStatus: 409 });

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-uq', version: 2 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].txId).toBeTruthy();
  });

  describe('verify', () => {
    it('returns the on-chain proof for matching content (key order does not matter)', async () => {
      const content = { report: { patient: 'anon-1', values: [1, 2.5, 'ok'] }, issued: '2025-01-01' };
      await issue('doc-vf', 5, content);
      await service.anchorDocument('doc-vf', 5);
      await worker.runConfirmationPass();

      const row = await repo.findAnchor('doc-vf', 5);
      expect(row?.status).toBe('confirmed');

      const report = await service.verify('doc-vf', 5, { issued: '2025-01-01', report: { values: [1, 2.5, 'ok'], patient: 'anon-1' } });
      expect(report.match).toBe(true);
      expect(report.differences).toEqual([]);
      expect(report.anchorState).toBe('confirmed');
      expect(report.proof).toEqual({
        txId: row?.txId,
        blockNumber: row?.blockNumber,
        blockHash: row?.receipt?.blockHash,
      });
    });

    it('returns a mismatch report that says what differs', async () => {
      const content = { patient: 'anon-9', labs: { hgb: 12.5, wbc: 6.1 }, flags: [] };
      await issue('doc-mm', 1, content);
      await service.anchorDocument('doc-mm', 1);
      await worker.runConfirmationPass();

      const tampered = { patient: 'ANON-9', labs: { hgb: 13.0, wbc: 6.1 }, flags: ['review'], extra: 1 };
      const report = await service.verify('doc-mm', 1, tampered);

      expect(report.match).toBe(false);
      expect(report.storedContentHash).not.toBe(report.suppliedContentHash);
      expect(report.proof).toBeNull(); // no proof is served for content that does not match

      const byPath = new Map(report.differences.map((d) => [d.path, d]));
      expect(byPath.get('$.patient')?.kind).toBe('value');
      expect(byPath.get('$.patient')?.stored).toBe('anon-9');
      expect(byPath.get('$.patient')?.supplied).toBe('ANON-9');
      expect(byPath.get('$.labs.hgb')?.kind).toBe('value');
      expect(byPath.get('$.labs.hgb')?.stored).toBe(12.5);
      expect(byPath.get('$.labs.hgb')?.supplied).toBe(13);
      expect(byPath.get('$.labs.wbc')).toBeUndefined(); // unchanged fields are not reported
      expect(byPath.get('$.flags[0]')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.supplied).toBe(1);
    });

    it('reports pending anchors (matching content, no block yet) and rejects unknown versions/anchors', async () => {
      chain.setBroadcast(() => new Promise<void>(() => {})); // the anchor will never confirm
      await issue('doc-pd', 1, { a: 1 });
      await service.anchorDocument('doc-pd', 1);

      const pending = await service.verify('doc-pd', 1, { a: 1 });
      expect(pending.match).toBe(true);
      expect(pending.anchorState).toBe('broadcast_unknown');
      expect(pending.proof).toBeNull();

      await expect(service.anchorDocument('ghost', 1)).rejects.toMatchObject({ code: 'document_version_not_found', httpStatus: 404 });
      await expect(service.verify('ghost', 1, { a: 1 })).rejects.toMatchObject({ code: 'document_version_not_found' });

      await issue('doc-na', 1, { a: 1 });
      await expect(service.verify('doc-na', 1, { a: 1 })).rejects.toMatchObject({ code: 'anchor_not_found', httpStatus: 404 });
    });
  });

  describe('canonicalization (per docs/canonicalization.md)', () => {
    it('is key-order insensitive and number-normalizing', () => {
      expect(canonicalize({ b: 1, a: { d: 2, c: [true, null] } })).toBe('{"a":{"c":[true,null],"d":2},"b":1}');
      expect(canonicalHash({ b: 1, a: { c: [true, null], d: 2 } })).toBe(canonicalHash({ a: { d: 2, c: [true, null] }, b: 1 }));
      expect(canonicalHash({ n: 1.1, m: 1e2 })).toBe(canonicalHash({ n: 1.1, m: 100 }));
      expect(canonicalize({ s: 'x"y' })).toBe('{"s":"x\\"y"}');
      expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects non-JSON values and drops undefined-valued keys', () => {
      expect(() => canonicalize({ bad: Number.NaN })).toThrow();
      expect(canonicalize({ a: 1, gone: undefined })).toBe('{"a":1}');
    });
  });
});
```

Wait — the `beforeEach` order: makeProcess uses `repo` (set in beforeAll) ✓. The cleanup after the process creation is fine.

One issue: the write-ahead test — `chain.setBroadcast(async (_signedTx, txId, state) => {...})` — the `_signedTx` is an unused parameter ✓ fine.

Another: the test "process crash" — the `chain` is from the current test's process; the `makeProcess()` for the restart creates a new client over the same chainState ✓.

`rows[0]` — TS: noUncheckedIndexedAccess is not enabled (not part of strict) → rows[0] is fine.

**test/anchoring.api.spec.ts** — as drafted. Let me double-check the imports and the env manipulation.

Also — the API spec's `beforeAll` needs to set the env before the module is compiled (the config factory runs at provider instantiation, during compile/init). Set it first ✓.

One more consideration: the `Test.createTestingModule` needs the reflect-metadata import? @nestjs/testing imports it. Fine.

Now — a subtle point: the API test's issue endpoint POST body `{ version: 1, content }` — my controller's `issueVersion` uses `body.version` and `body.content` ✓.

The default InMemoryChainClient's `broadcast` (behavior null) lands + resolves → the anchor's status is broadcast_sent ✓ within the request.

**Let me re-check the controller's Omit return**: `Omit<StoredAnchor, 'signedTx'>` — the StoredAnchor import as a type ✓.

**The worker's Logger usage**: let me add:

```ts
      if (receipt) {
        const advanced = await this.repo.transition(...);
        if (advanced) this.logger.log(`recovered anchor ${row.id} (${row.status}) from receipt in block ${receipt.blockNumber}`);
        continue;
      }
      ...
      const advanced = await this.repo.transition(...);
      if (advanced) this.logger.log(`re-broadcast signed tx of anchor ${row.id} (no trace on chain); attempts=${...}`);
```
Keep it simple: log on success. Let me write it.

**The service's file — the full version**:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import type { StoredAnchor, StoredVersion } from './anchoring.repository.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';
import { diffJson, type ContentDifference } from './content-diff.js';
import { canonicalHash } from './canonicalize.js';
import { anchorNotFoundError, documentVersionNotFoundError, invalidAnchorContentError } from '../common/domain-exception.js';

export interface AnchorProof {
  txId: string;
  blockNumber: number;
  blockHash: string;
}

export interface VerificationReport {
  documentId: string;
  version: number;
  storedContentHash: string;
  suppliedContentHash: string;
  match: boolean;
  /** The anchor's lifecycle state: prepared | broadcast_sent | broadcast_unknown | confirmed | failed. */
  anchorState: StoredAnchor['status'];
  /** Present only when the supplied content matches AND the anchor is confirmed. */
  proof: AnchorProof | null;
  /** Populated only when the content does not match. */
  differences: ContentDifference[];
}

@Injectable()
export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  /** Issue a new report version. The structured JSON is the source of truth. */
  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    this.canonicalHashOrThrow(content);
    return this.repo.createVersion(documentId, version, content);
  }

  /**
   * Anchor a published report version on the L2.
   *
   * The order is the incident fix:
   *   1. canonical hash of the structured content
   *   2. prepare() — the tx identity exists now, before any broadcast
   *   3. persist the anchor intent (including the tx identity) and commit
   *   4. only then broadcast
   * If the process dies at any point after step 3, recovery has the txId and
   * can ask the chain what happened.
   *
   * broadcast() returning does NOT confirm the anchor: confirmation comes
   * from a receipt, via the confirmation worker and the recovery sweep.
   */
  async anchorDocument(documentId: string, version: number): Promise<StoredAnchor> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const contentHash = this.canonicalHashOrThrow(versionRow.content);

    const prepared = this.chain.prepare({ documentId, version, contentHash });

    // Write-ahead: this commit happens before broadcast, with the tx identity.
    const anchor = await this.repo.createAnchor({ documentId, version, contentHash, txId: prepared.txId, signedTx: prepared.signedTx });

    const outcome = await attemptBroadcast(this.chain, anchor.signedTx, this.config.broadcastTimeoutMs);
    await this.repo.transition(anchor.id, ['prepared'], outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown', {
      incrementBroadcastAttempts: true,
    });

    return (await this.repo.findById(anchor.id)) ?? anchor;
  }

  /**
   * Recompute the hash from the supplied content and return either the
   * anchoring proof (txId, block) or a mismatch report that says what differs.
   */
  async verify(documentId: string, version: number, suppliedContent: unknown): Promise<VerificationReport> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const suppliedHash = this.canonicalHashOrThrow(suppliedContent);

    const anchor = await this.repo.findAnchor(documentId, version);
    if (!anchor) throw anchorNotFoundError(documentId, version);

    const match = suppliedHash === anchor.contentHash;

    let proof: AnchorProof | null = null;
    if (match && anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt !== null) {
      proof = { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.receipt.blockHash };
    }

    return {
      documentId,
      version,
      storedContentHash: anchor.contentHash,
      suppliedContentHash: suppliedHash,
      match,
      anchorState: anchor.status,
      proof,
      differences: match ? [] : diffJson(versionRow.content, suppliedContent),
    };
  }

  private canonicalHashOrThrow(content: unknown): string {
    try {
      return canonicalHash(content);
    } catch (error) {
      throw invalidAnchorContentError(error instanceof Error ? error.message : String(error));
    }
  }
}
```

`StoredAnchor['status']` = AnchorState ✓.

**The repository's final version** — let me make sure the `Prisma.AnchorGetPayload<{}>` import is OK. And the `content` Json → `row.content` is JsonValue (a union) → StoredVersion.content: unknown ✓ assignable.

**Now, the module's file** — with the ASSUMPTION comment:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchoringController } from './anchoring.controller.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { AnchoringService } from './anchoring.service.js';
import { AnchoringWorker } from './anchoring.worker.js';
import { ANCHORING_CONFIG, anchoringConfigFromEnv } from './anchoring.config.js';
import { CHAIN_CLIENT } from './chain-client.js';
import { InMemoryChainClient } from './in-memory-chain-client.js';

@Module({
  imports: [PrismaModule],
  controllers: [AnchoringController],
  providers: [
    AnchoringService,
    AnchoringRepository,
    AnchoringWorker,
    { provide: ANCHORING_CONFIG, useFactory: anchoringConfigFromEnv },
    // ASSUMPTION: no real L2 client exists in scope ("no real keys and no RPC"),
    // so the in-process implementation is the default provider; a deployment
    // replaces this provider with a real ChainClient.
    { provide: CHAIN_CLIENT, useFactory: () => new InMemoryChainClient() },
  ],
  exports: [AnchoringService],
})
export class AnchoringModule {}
```

**The controller's final version**:

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { StoredAnchor } from './anchoring.repository.js';
import { AnchoringService } from './anchoring.service.js';
import { validationError } from '../common/domain-exception.js';

@Controller('documents')
export class AnchoringController {
  constructor(private readonly anchoring: AnchoringService) {}

  /** Issue a new report version (structured JSON, the source of truth). */
  @Post(':documentId/versions')
  issueVersion(@Param('documentId') documentId: string, @Body() body: { version?: unknown; content?: unknown } = {}) {
    return this.anchoring.createVersion(this.requireDocumentId(documentId), this.requireVersion(body.version), this.requireContent(body.content));
  }

  /** Anchor a published version on the L2 (write-ahead intent, then broadcast). */
  @Post(':documentId/versions/:version/anchors')
  async createAnchor(@Param('documentId') documentId: string, @Param('version') version: string): Promise<Omit<StoredAnchor, 'signedTx'>> {
    const anchor = await this.anchoring.anchorDocument(this.requireDocumentId(documentId), this.requireVersion(version));
    // The signed tx is internal (re-broadcast material), never exposed by the API.
    const { signedTx: _signedTx, ...visible } = anchor;
    return visible;
  }

  /** Verify supplied content against the anchor: proof or mismatch report. */
  @Post(':documentId/versions/:version/anchors/verifications')
  @HttpCode(200)
  verify(@Param('documentId') documentId: string, @Param('version') version: string, @Body() body: { content?: unknown } = {}) {
    return this.anchoring.verify(this.requireDocumentId(documentId), this.requireVersion(version), body.content);
  }

  private requireDocumentId(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw validationError('documentId must be a non-empty string', { documentId: raw ?? null });
    }
    return raw;
  }

  private requireVersion(raw: unknown): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
      throw validationError('version must be a positive integer', { version: raw ?? null });
    }
    return version;
  }

  private requireContent(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw validationError('content must be a JSON object', {});
    }
    return raw as Record<string, unknown>;
  }
}
```

**The worker's final version**:

```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';

const PAGE_SIZE = 100;
const LIMBO_STATES = ['prepared', 'broadcast_unknown'] as const;

/**
 * Confirmation worker + recovery sweep.
 *
 * Confirmation: `broadcast_sent` anchors are polled for a receipt and advanced
 * to `confirmed`/`failed`. Confirmation always comes from a receipt, never
 * from broadcast() returning.
 *
 * Recovery: anchors stuck in broadcast-limbo (`prepared`, `broadcast_unknown`)
 * are resolved by querying the chain FIRST. If a receipt exists, the anchor is
 * confirmed from it — no re-broadcast. Only when the chain has no trace is the
 * SAME signed tx re-broadcast (never a new one, so a re-send cannot become a
 * second anchor).
 */
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** One confirmation pass: poll receipts and advance broadcast-sent anchors. */
  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const advanced = await this.repo.transition(row.id, ['broadcast_sent'], receipt.status === 'success' ? 'confirmed' : 'failed', {
        blockNumber: receipt.blockNumber,
        receipt,
      });
      if (advanced) this.logger.log(`anchor ${row.id} ${receipt.status === 'success' ? 'confirmed' : 'failed'} at block ${receipt.blockNumber}`);
    }
  }

  /** One recovery pass: resolve anchors stuck in broadcast-limbo, chain first. */
  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck([...LIMBO_STATES], stuckBefore, PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        // The tx landed (e.g. despite a broadcast timeout): confirm from the
        // receipt. Never re-broadcast.
        const advanced = await this.repo.transition(row.id, [...LIMBO_STATES], receipt.status === 'success' ? 'confirmed' : 'failed', {
          blockNumber: receipt.blockNumber,
          receipt,
        });
        if (advanced) this.logger.log(`recovered anchor ${row.id} from chain receipt, block ${receipt.blockNumber}`);
        continue;
      }
      // No trace on chain: re-broadcast the same signed transaction. (If two
      // workers race, the chain deduplicates by tx identity — one anchor.)
      const outcome = await attemptBroadcast(this.chain, row.signedTx, this.config.broadcastTimeoutMs);
      const advanced = await this.repo.transition(row.id, [...LIMBO_STATES], outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown', {
        incrementBroadcastAttempts: true,
      });
      if (advanced) this.logger.log(`re-broadcast signed tx of anchor ${row.id} (no trace on chain)`);
    }
  }
}
```

`[...LIMBO_STATES]` → `('prepared' | 'broadcast_unknown')[]` ✓ assignable to AnchorState[].

The repository's `listStuck(states: AnchorState[], ...)` ✓.

**The repository's final version** — one more check: the `toStoredAnchor`'s receipt cast `(row.receipt ?? null) as ChainReceiptRecord | null` — row.receipt is `JsonValue | null` → the cast is fine.

The `transition`'s data: `Prisma.AnchorUpdateManyMutationInput` — includes status, blockNumber (BigInt), receipt (InputJsonValue), broadcastAttempts ({increment}) ✓.

Now, is `Prisma.AnchorUpdateManyMutationInput` exported? Yes, `Prisma.AnchorUpdateManyMutationInput` exists for updateMany. ✓.

**The API spec's final version** — as drafted, plus a `content-type` header. And the response of `issued` — I don't need to check the body.

Let me also confirm that the API spec's verify uses a POST with a body — yes.

**Potential runtime issue**: Nest 10 + Express 4 — the fetch POST without a body (the anchor endpoint) is fine.

**The `app.getUrl()`** — after `listen(0)`, returns `http://127.0.0.1:port` or localhost ✓.

Now — the "never reproduce the reference material" constraint — my code is original; the doc is my own wording. Fine.

**Let me reconsider the `version` field name collision**: the route param `:version` + the body's version — fine.

**The Prisma schema's Document model — a name collision with a Prisma reserved word?** "Document" is fine.

**The enum `@@map("AnchorStatus")`** — the DB type name AnchorStatus ✓ matches the migration's `CREATE TYPE "AnchorStatus"`.

**The `@default(now())` on the DateTime** → TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP ✓.

**The `@updatedAt`** → maintained by the client; the migration is a plain column ✓.

Now — one more thought about the `documents` table's necessity. The alternative was to skip the documents parent and just have document_versions with no FK. I included the Document for integrity. The migration creates documents first ✓. The deleteMany order in the tests: anchors, document_versions, documents (the FK) ✓.

**Let me re-verify the `createVersion`'s upsert**: the document's id = documentId (a string from the URL). A URL with special characters — out of scope.

**The `requireDocumentId`'s details `{ documentId: raw ?? null }`** — raw is a string from the route param; fine.

**The validation_error's details for a bad version**: `{ version: 'not-an-int' }` — the API test asserts `body.error.details.version` === 'not-an-int' ✓.

**The 404 test**: the details `{ documentId: 'ghost-doc', version: 1 }` ✓.

Now — the TS: the `@Body() body: { version?: unknown; content?: unknown } = {}` — a default parameter on a decorated method parameter: Nest's DI — a default value on a @Body() parameter... Nest's parameter decorators: the default `= {}` is a TS default — when Nest calls the method, it passes the parsed body (an object) → the default is unused. If there's no body, express json gives {}? For a POST with no body, body-parser gives `{}` → fine. OK.

**The `issueVersion` return type** — StoredVersion ✓ (an async method returning a promise ✓).

I think the design is solid. Let me also re-check the "no raw SQL in the service" — the service has none ✓. "The repository is the only layer that touches the database" — the worker/service don't touch prisma ✓. The controller has zero logic beyond validation + stripping ✓.

**The test discipline**: every test has meaningful assertions on behavior (DB state, chain state, response shapes) — no "assert only that a call happened" (the broadcastLog assertions are about the chain's accepted-txs behavior = the resend idempotency contract, tied to the resulting single anchor).

Now, let me write the final reply with all 26 files. The fenced block language hints: ts, json, prisma, sql, toml, md. Use the appropriate one.

One more detail — the format requires a level-3 heading with only the path. Example: `### package.json`. Then a fence. Nothing else.

Let me also make sure there are no accidental triple-backticks inside the file contents (the doc uses 4-space indentation ✓; the code files have no fences).

Also, the migration's timestamp directory name: `20250101000000_init` is conventional ✓.

Final check of `vitest` config option name for vitest 2: `fileParallelism` (renamed from `threads: false`?). In Vitest 2, `fileParallelism: false` disables file parallelism ✓ (introduced in 1.6 as `fileParallelism`? Actually, `fileParallelism` was added in Vitest 2.0? Hmm — Vitest 1.x used `threads: true/false` for pool threads; `singleThread`. The `fileParallelism` option exists in Vitest 2.x ✓. Since I pinned vitest ^2.0.0, `fileParallelism: false` is valid. If the parser is strict on the config — it's fine.

Also — the `hookTimeout` top-level in the test config ✓.

Also the package.json's "pretest" — pnpm runs pretest automatically ✓.

Let me reconsider once more: the tests use `new PrismaService()` directly + the API spec uses the module's PrismaService — two connections in separate workers ✓.

And the main spec's `beforeAll` — `prisma.$connect()` needs DATABASE_URL; if it's unset, the PrismaClient constructor throws — the environment provides it (per the convention). Fine.

Now — is there a risk that the `PrismaService` (the PrismaClient subclass) is used with the `document`/`documentVersion`/`anchor` delegates? The model names: Document, DocumentVersion, Anchor → the delegates are `prisma.document`, `prisma.documentVersion`, `prisma.anchor` ✓.

The relation field `document` on DocumentVersion — the FK. ✓.

`documentId_version` composite unique input ✓.

I'm confident. Let me now compose the reply. The file order as listed. The headings exactly the repo-relative paths.

Actually — one more thought on `src/common/domain-exception.ts` vs the convention's file pattern "kebab-case.role.ts": `domain-exception.ts` doesn't have a role. The roles in the layout are for feature files (module/controller/service/repository). Shared types/errors — I could name it `errors.exception.ts`?? Ugly. Let me keep `domain-exception.ts` — it's a class definition file; the convention's role suffix applies to the feature layer files. Acceptable.

And `all-exceptions.filter.ts` has the role "filter" ✓.

Also — should the worker be a "processor"? The convention's layout doesn't show a processor file, but the wiring notes mention "a service, repository, or processor" → the processor is recognized. My `anchoring.worker.ts` is that processor. Name it `anchoring.processor.ts`? "Worker" matches the task's language ("confirmation worker", "recovery sweep"). The task calls them a worker + a sweep. Let me keep `anchoring.worker.ts` — it's a kebab-case role file ✓.

The final answer composition — 26 headings + fences. Let me write it.

Also, let me double-check that the `docs/canonicalization.md`'s example line uses consistent spacing (4-space indent) — in my reply it's inside a markdown file; fine.

Also confirm that the `-0` claim in the doc: JSON.stringify(-0) === "0" ✓.

And `1e2` → JSON.stringify(1e2) = "100" ✓; `1e21` → "1e+21" ✓.

Let me write the files.

One last check on the API spec: after `await app.init()`, `await app.listen(0)`. Then `app.getUrl()`. And the cleanup uses `app.get(PrismaService)` ✓.

And in afterAll, the order: delete, then close ✓.

Also — the API spec's file and the main spec's file both delete the same table, but serialized via fileParallelism false ✓.

The main spec's describe name mentions the behavior ✓.

Also, hmm: the `waitForAnchor` in the write-ahead test — the anchorCall promise might reject (e.g., if something fails) while I'm polling — the unhandled rejection? The anchorCall is eventually awaited (`await anchorCall` after the release). If it rejects before that (it won't — the flow is deterministic), the rejection is held by the promise variable (not unhandled, since I hold the reference? a rejected promise with no handler attached at the time of rejection → does Node flag unhandledRejection only if no handler is attached by the end of the turn? Actually, an unhandledRejection is emitted if no handler is attached by the end of the microtask/task... a variable-held promise: I attach the handler later (after the release) — the unhandledrejection event fires in the next tick if no handler is attached. In our flow, the anchorCall can't reject before the release (the createAnchor is committed, the broadcast hangs; no failure path). Safe.

But to be safe, I could attach a catch early: `anchorCall.catch(() => undefined)`? That would swallow... no — I still await it (the original promise) — attaching an additional catch doesn't consume it. Let me add `anchorCall.catch(() => undefined);` right after creation to silence potential unhandled rejections. A good defensive touch; harmless. Hmm, but "test behavior not implementation" — it's a test hygiene. Let me add it.

Similarly, the other tests await immediately ✓.

Now — let me finalize everything and write it out. Also, the small `void` for the unused: the controller's `_signedTx` — the tsconfig's strict doesn't flag unused (no noUnusedLocals) ✓.

The `makeProcess` return type is explicit ✓.

The spec: the `process` variable name shadows the global process in the beforeEach — the local `const process` — I use `process.env`? No, the main spec doesn't use process.env. But the shadowing is a lint smell; let me rename to `p`.

Let me write it.

Also, I realize I should double-check the `InMemoryChainClient`'s `prepare` determinism across client instances: the txId is derived from the input only ✓ (the txIds map is per-instance but the derivation is the same) → the "restart" client would produce the same txId for the same input — good (the chain's identity is consistent).

And in the crash test, the restarted worker only does getReceipt — no prepare needed ✓.

Ready. Let me also make sure that no file's content exceeds a reasonable size — fine.

One more: the task says "a confirmation worker polling receipts and advancing state; a recovery sweep that resolves anchors stuck in broadcast-limbo by querying the chain first." — my worker does both on separate intervals; in tests I drive the passes. ✓.

And the acceptance "an intent including tx identity is committed before broadcast() is called" — proven by test 1 ✓.

Deliverables checklist: Prisma schema with the uniqueness constraint ✓ · anchorDocument, verify ✓ · the confirmation worker and the recovery sweep ✓ · tests for the acceptance cases ✓ · the documented canonicalization ✓.

Now let me write the final output.
```

## reply

### package.json
```json
{
  "name": "report-anchoring",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "pretest": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@prisma/client": "^5.18.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.18.0",
    "tsx": "^4.17.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
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
    // The suites share one Postgres database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
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

model Document {
  id       String            @id @map("id")
  versions DocumentVersion[]

  @@map("documents")
}

model DocumentVersion {
  id         String   @id @default(uuid()) @map("id")
  documentId String   @map("document_id")
  version    Int
  content    Json
  createdAt  DateTime @default(now()) @map("created_at")
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, version])
  @@map("document_versions")
}

enum AnchorStatus {
  PREPARED          @map("prepared")
  BROADCAST_SENT    @map("broadcast_sent")
  BROADCAST_UNKNOWN @map("broadcast_unknown")
  CONFIRMED         @map("confirmed")
  FAILED            @map("failed")

  @@map("AnchorStatus")
}

model Anchor {
  id                String       @id @default(uuid()) @map("id")
  documentId        String       @map("document_id")
  version           Int
  contentHash       String       @map("content_hash")
  txId              String       @map("tx_id")
  signedTx          String       @map("signed_tx")
  status            AnchorStatus @default(PREPARED) @map("status")
  blockNumber       BigInt?      @map("block_number")
  receipt           Json?        @map("receipt")
  broadcastAttempts Int          @default(0) @map("broadcast_attempts")
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")

  // One anchor per (document, version): enforced by the database, not the app.
  @@unique([documentId, version])
  @@map("anchors")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git or svn)
provider = "postgresql"
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('prepared', 'broadcast_sent', 'broadcast_unknown', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL DEFAULT uuid(),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anchors" (
    "id" TEXT NOT NULL DEFAULT uuid(),
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "tx_id" TEXT NOT NULL,
    "signed_tx" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'prepared',
    "block_number" BIGINT,
    "receipt" JSONB,
    "broadcast_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "anchors_document_id_version_key" ON "anchors"("document_id", "version");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### docs/canonicalization.md
```md
# Canonicalization of report content

The structured JSON of an issued report version is the source of truth. The PDF
is a rendering of that JSON and is never part of the hash. An anchor is
`SHA-256(canonical_bytes)` where `canonical_bytes` is the UTF-8 encoding of the
canonical serialization below, written as 64 lowercase hex characters.

## Canonical serialization rules

Input: the parsed JSON value of the stored report version (a JSON object).

1. Objects
   - Keys are sorted lexicographically in UTF-16 code unit order (the default
     JavaScript `Array.prototype.sort` on strings) and emitted in that order.
   - A key whose value is `undefined` is omitted entirely (JSON.stringify
     semantics). After `JSON.parse` this cannot occur, so stored and supplied
     content behave identically.
   - Emitted compactly: `{"k1":v1,"k2":v2}` — no whitespace between tokens.
2. Arrays
   - Element order is significant and preserved: `[e1,e2,...]`.
3. Strings
   - Emitted with `JSON.stringify` escaping: quotes, backslashes and control
     characters are escaped; all other code points pass through unchanged.
4. Numbers
   - Emitted as the shortest decimal string that round-trips to the same
     IEEE-754 double — exactly what `JSON.stringify` produces (`12.5`, `100`,
     `1e+21`). Consequently `1.10` and `1.1` canonicalize identically, as do
     `1e2` and `100`, and `-0` and `0`.
   - Non-finite values (NaN, +/-Infinity) are not representable in JSON and are
     rejected, not hashed.
5. Booleans and null
   - The literals `true`, `false`, `null`.
6. Anything else
   - Any other JavaScript type (function, symbol, bigint, ...) is rejected.

## Worked example

    input:      { "b": 1, "a": { "d": 2, "c": [true, null] } }
    canonical:  {"a":{"c":[true,null],"d":2},"b":1}
    hash:       sha256(UTF-8(canonical)) in lowercase hex

## What does not affect the hash

- Key insertion order of objects.
- Whitespace and formatting of the original JSON text.
- Numeric notation that denotes the same double (`1.10` is `1.1`).
- The PDF rendering, file names, and any rendering metadata.

## Reproduction

An auditor recomputes the hash from the stored (or supplied) content as:
parse JSON, apply the rules above, UTF-8 encode, SHA-256, lowercase hex.
Reference implementation: `src/anchoring/canonicalize.ts`
(`canonicalize` and `canonicalHash`).
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchoringModule } from './anchoring/anchoring.module.js';

@Module({
  imports: [AnchoringModule],
})
export class AppModule {}
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

### src/common/domain-exception.ts
```ts
/**
 * Domain errors carrying a stable `code` (the contract) and an HTTP status.
 * The global filter renders every error as the single envelope:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `message` is developer-facing English; `details` is always an object.
 */
export class DomainException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainException';
  }
}

export const validationError = (message: string, details: Record<string, unknown> = {}): DomainException =>
  new DomainException('validation_error', message, 400, details);

export const documentVersionNotFoundError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'document_version_not_found',
    `document ${documentId} version ${version} was not issued`,
    404,
    { documentId, version },
  );

export const documentVersionConflictError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'document_version_conflict',
    `document ${documentId} version ${version} was already issued`,
    409,
    { documentId, version },
  );

export const anchorNotFoundError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'anchor_not_found',
    `no anchor exists for document ${documentId} version ${version}`,
    404,
    { documentId, version },
  );

export const anchorConflictError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'anchor_conflict',
    `an anchor already exists for document ${documentId} version ${version}`,
    409,
    { documentId, version },
  );

export const invalidAnchorContentError = (reason: string): DomainException =>
  new DomainException('invalid_anchor_content', `report content cannot be anchored: ${reason}`, 422, { reason });
```

### src/common/all-exceptions.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * The single error envelope for the whole API:
 *   { "error": { "code": "...", "message": "...", "details": {} } }
 * `code` is snake_case and is the contract; `details` is always an object,
 * never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ErrorEnvelope } {
    if (exception instanceof DomainException) {
      return {
        status: exception.httpStatus,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const err = (payload as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
        if (err && typeof err.code === 'string') {
          return {
            status,
            body: {
              error: {
                code: err.code,
                message: typeof err.message === 'string' ? err.message : exception.message,
                details: (err.details as Record<string, unknown> | undefined) ?? {},
              },
            },
          };
        }
      }
      const code =
        status === 400
          ? 'validation_error'
          : status === 404
            ? 'not_found'
            : status === 409
              ? 'conflict'
              : status === 422
                ? 'unprocessable_content'
                : 'http_error';
      return { status, body: { error: { code, message: exception.message, details: {} } } };
    }
    return { status: 500, body: { error: { code: 'internal_error', message: 'internal server error', details: {} } } };
  }
}
```

### src/anchoring/anchoring.config.ts
```ts
/** Runtime configuration, from environment variables only. */
export interface AnchoringConfig {
  /** Give up waiting for broadcast() after this long; the outcome is then unknown. */
  broadcastTimeoutMs: number;
  /** How often the confirmation worker polls receipts (0 disables the timer). */
  confirmationPollMs: number;
  /** How often the recovery sweep runs (0 disables the timer). */
  recoverySweepMs: number;
  /** A limbo row must be at least this old before the sweep touches it, so the sweep never races in-flight work. */
  stuckAfterMs: number;
}

export const ANCHORING_CONFIG = 'ANCHORING_CONFIG';

function nonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function anchoringConfigFromEnv(): AnchoringConfig {
  return {
    broadcastTimeoutMs: nonNegativeInt('BROADCAST_TIMEOUT_MS', 30_000),
    confirmationPollMs: nonNegativeInt('ANCHORING_CONFIRMATION_POLL_MS', 5_000),
    recoverySweepMs: nonNegativeInt('ANCHORING_RECOVERY_SWEEP_MS', 60_000),
    stuckAfterMs: nonNegativeInt('ANCHORING_STUCK_AFTER_MS', 60_000),
  };
}
```

### src/anchoring/chain-client.ts
```ts
/**
 * The chain-client contract (no real keys, no RPC — code against this
 * interface; tests and the local default use an in-memory implementation):
 *
 *   prepare(tx)         -> { txId, signedTx }   local, deterministic
 *   broadcast(signedTx) -> Promise<void>        may time out, outcome unknown
 *   getReceipt(txId)    -> Promise<ChainReceipt | null>  the receipt once included, else null
 *
 * Key property: `prepare` is local, so the transaction identity exists BEFORE
 * any broadcast. Confirmation always comes from `getReceipt`, never from
 * `broadcast()` returning.
 */

export interface ChainTxInput {
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
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface ChainClient {
  prepare(tx: ChainTxInput): PreparedTx;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

export const CHAIN_CLIENT = 'CHAIN_CLIENT';
```

### src/anchoring/in-memory-chain-client.ts
```ts
import { createHash } from 'node:crypto';
import type { ChainClient, ChainReceipt, ChainTxInput, PreparedTx } from './chain-client.js';

/**
 * The "chain" side of the fake: state a real L2 would keep regardless of our
 * process (accepted txs, receipts, block numbers). Sharing one instance across
 * two InMemoryChainClient instances simulates a process restart: the app state
 * is gone, the chain is not.
 */
export class InMemoryChainState {
  readonly receipts = new Map<string, ChainReceipt>();
  /** Every signed tx the chain has accepted, in order (duplicates included). */
  readonly broadcastLog: string[] = [];
  private nextBlock = 1;

  land(txId: string, status: 'success' | 'failure' = 'success'): void {
    if (this.receipts.has(txId)) return; // the chain deduplicates by tx identity
    this.receipts.set(txId, {
      txId,
      blockNumber: this.nextBlock++,
      blockHash: `blk_${txId.slice(0, 16)}`,
      status,
    });
  }
}

/**
 * In-process ChainClient. It is the default provider because the task scopes
 * out real keys/RPC, and it doubles as the fake for tests (via `setBroadcast`
 * to simulate timeouts, crashes, and non-landing).
 */
export class InMemoryChainClient implements ChainClient {
  private readonly txIds = new Map<string, string>();
  private behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null = null;

  constructor(readonly state: InMemoryChainState = new InMemoryChainState()) {}

  prepare(tx: ChainTxInput): PreparedTx {
    const digest = createHash('sha256').update(`${tx.documentId}|${tx.version}|${tx.contentHash}`).digest('hex');
    const txId = `tx_${digest.slice(0, 40)}`;
    const signedTx = `signed:${txId}`;
    this.txIds.set(signedTx, txId);
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId =
      this.txIds.get(signedTx) ?? `tx_${createHash('sha256').update(signedTx).digest('hex').slice(0, 40)}`;
    this.state.broadcastLog.push(signedTx);
    if (this.behavior) {
      await this.behavior(signedTx, txId, this.state);
    } else {
      this.state.land(txId);
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.state.receipts.get(txId) ?? null;
  }

  /** Test hook: override the broadcast behavior. null restores the default (accept and land). */
  setBroadcast(behavior: ((signedTx: string, txId: string, state: InMemoryChainState) => Promise<void>) | null): void {
    this.behavior = behavior;
  }
}
```

### src/anchoring/canonicalize.ts
```ts
import { createHash } from 'node:crypto';

/**
 * Canonical serialization of report content — the written spec is
 * docs/canonicalization.md; this is the reference implementation an auditor
 * can diff against.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`non-finite number cannot be canonically serialized: ${value}`);
      }
      // Shortest round-trip decimal representation (JSON.stringify semantics).
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      // Keys sorted lexicographically (UTF-16 code unit order); undefined values omitted.
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
    }
    default:
      throw new Error(`unsupported value type in report content: ${typeof value}`);
  }
}

/** SHA-256 of the canonical UTF-8 bytes, 64 lowercase hex characters. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
```

### src/anchoring/content-diff.ts
```ts
/**
 * Path-level differences between the stored report content and supplied
 * content. Only called when the canonical hashes differ, so at least one
 * difference is always produced.
 */
export interface ContentDifference {
  /** JSON path: `$`, `$.a.b`, `$.a[0].c`. */
  path: string;
  kind: 'value' | 'missing_in_supplied' | 'missing_in_stored';
  stored?: unknown;
  supplied?: unknown;
}

export function diffJson(stored: unknown, supplied: unknown): ContentDifference[] {
  const differences: ContentDifference[] = [];
  walk(stored, supplied, '$', differences);
  return differences;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(stored: unknown, supplied: unknown, path: string, out: ContentDifference[]): void {
  if (Array.isArray(stored) && Array.isArray(supplied)) {
    const shared = Math.min(stored.length, supplied.length);
    for (let i = 0; i < shared; i++) walk(stored[i], supplied[i], `${path}[${i}]`, out);
    for (let i = shared; i < stored.length; i++) {
      out.push({ path: `${path}[${i}]`, kind: 'missing_in_supplied', stored: stored[i] });
    }
    for (let i = shared; i < supplied.length; i++) {
      out.push({ path: `${path}[${i}]`, kind: 'missing_in_stored', supplied: supplied[i] });
    }
    return;
  }
  if (isPlainObject(stored) && isPlainObject(supplied)) {
    const keys = Array.from(new Set([...Object.keys(stored), ...Object.keys(supplied)])).sort();
    for (const key of keys) {
      const child = `${path}.${key}`;
      if (!(key in stored)) out.push({ path: child, kind: 'missing_in_stored', supplied: supplied[key] });
      else if (!(key in supplied)) out.push({ path: child, kind: 'missing_in_supplied', stored: stored[key] });
      else walk(stored[key], supplied[key], child, out);
    }
    return;
  }
  if (leavesDiffer(stored, supplied)) out.push({ path, kind: 'value', stored, supplied });
}

function leavesDiffer(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a !== b;
  if (typeof a === 'object' || typeof b === 'object') return true; // mixed shapes (object vs primitive)
  return a !== b;
}
```

### src/anchoring/broadcast.ts
```ts
import type { ChainClient } from './chain-client.js';

/**
 * Broadcast with a bounded wait. A successful return means "accepted for
 * broadcast" only — confirmation comes from a receipt, never from here.
 * A timeout or rejection means the outcome is UNKNOWN: the tx may or may not
 * have landed, and the recovery sweep will ask the chain.
 */
export async function attemptBroadcast(chain: ChainClient, signedTx: string, timeoutMs: number): Promise<'sent' | 'unknown'> {
  const broadcast = Promise.resolve().then(() => chain.broadcast(signedTx));
  // A late rejection (after we timed out) must not crash the process; the
  // state machine owns the outcome.
  broadcast.catch(() => undefined);
  try {
    await Promise.race([
      broadcast,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('broadcast timed out')), timeoutMs);
        timer.unref();
      }),
    ]);
    return 'sent';
  } catch {
    return 'unknown';
  }
}
```

### src/anchoring/anchoring.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { AnchorStatus, Prisma, PrismaClientKnownRequestError } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { anchorConflictError, documentVersionConflictError } from '../common/domain-exception.js';

/** Anchor lifecycle states (the schema enum; DB values are snake_case). */
export type AnchorState = 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed';

export interface ChainReceiptRecord {
  txId: string;
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface StoredVersion {
  id: string;
  documentId: string;
  version: number;
  content: unknown;
  createdAt: Date;
}

export interface StoredAnchor {
  id: string;
  documentId: string;
  version: number;
  status: AnchorState;
  contentHash: string;
  txId: string;
  signedTx: string;
  blockNumber: number | null;
  receipt: ChainReceiptRecord | null;
  broadcastAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const TO_DB: Record<AnchorState, AnchorStatus> = {
  prepared: AnchorStatus.PREPARED,
  broadcast_sent: AnchorStatus.BROADCAST_SENT,
  broadcast_unknown: AnchorStatus.BROADCAST_UNKNOWN,
  confirmed: AnchorStatus.CONFIRMED,
  failed: AnchorStatus.FAILED,
};

const TO_STATE: Record<AnchorStatus, AnchorState> = {
  [AnchorStatus.PREPARED]: 'prepared',
  [AnchorStatus.BROADCAST_SENT]: 'broadcast_sent',
  [AnchorStatus.BROADCAST_UNKNOWN]: 'broadcast_unknown',
  [AnchorStatus.CONFIRMED]: 'confirmed',
  [AnchorStatus.FAILED]: 'failed',
};

type AnchorRow = Prisma.AnchorGetPayload<{}>;

function toStoredAnchor(row: AnchorRow): StoredAnchor {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    status: TO_STATE[row.status],
    contentHash: row.contentHash,
    txId: row.txId,
    signedTx: row.signedTx,
    blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),
    receipt: (row.receipt ?? null) as ChainReceiptRecord | null,
    broadcastAttempts: row.broadcastAttempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';
}

/** The only layer that touches the database. All Prisma calls live here. */
@Injectable()
export class AnchoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVersion(documentId: string, version: number): Promise<StoredVersion | null> {
    const row = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    if (!row) return null;
    return { id: row.id, documentId: row.documentId, version: row.version, content: row.content, createdAt: row.createdAt };
  }

  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.document.upsert({ where: { id: documentId }, update: {}, create: { id: documentId } });
        await tx.documentVersion.create({ data: { documentId, version, content: content as Prisma.InputJsonValue } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw documentVersionConflictError(documentId, version);
      throw error;
    }
    const created = await this.findVersion(documentId, version);
    if (!created) throw new Error('createVersion: version row missing after commit');
    return created;
  }

  async createAnchor(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<StoredAnchor> {
    try {
      const row = await this.prisma.anchor.create({ data: { ...data, status: AnchorStatus.PREPARED } });
      return toStoredAnchor(row);
    } catch (error) {
      // One anchor per (document, version): the unique constraint is the enforcement.
      if (isUniqueViolation(error)) throw anchorConflictError(data.documentId, data.version);
      throw error;
    }
  }

  async findAnchor(documentId: string, version: number): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? toStoredAnchor(row) : null;
  }

  async findById(id: string): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({ where: { id } });
    return row ? toStoredAnchor(row) : null;
  }

  async listByStatuses(states: AnchorState[], limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  async listStuck(states: AnchorState[], stuckBefore: Date, limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) }, updatedAt: { lt: stuckBefore } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  /**
   * Atomic compare-and-set transition: only succeeds if the row is still in
   * one of `from` states. Returns false when a concurrent worker already
   * moved it, so two instances cannot double-advance or double-confirm.
   */
  async transition(
    id: string,
    from: AnchorState[],
    to: AnchorState,
    extra: { blockNumber?: number; receipt?: ChainReceiptRecord; incrementBroadcastAttempts?: boolean } = {},
  ): Promise<boolean> {
    const data: Prisma.AnchorUpdateManyMutationInput = { status: TO_DB[to] };
    if (extra.blockNumber !== undefined) data.blockNumber = BigInt(extra.blockNumber);
    if (extra.receipt !== undefined) data.receipt = extra.receipt as Prisma.InputJsonValue;
    if (extra.incrementBroadcastAttempts) data.broadcastAttempts = { increment: 1 };
    const result = await this.prisma.anchor.updateMany({
      where: { id, status: { in: from.map((s) => TO_DB[s]) } },
      data,
    });
    return result.count > 0;
  }
}
```

### src/anchoring/anchoring.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository, type StoredAnchor, type StoredVersion } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';
import { diffJson, type ContentDifference } from './content-diff.js';
import { canonicalHash } from './canonicalize.js';
import { anchorNotFoundError, documentVersionNotFoundError, invalidAnchorContentError } from '../common/domain-exception.js';

export interface AnchorProof {
  txId: string;
  blockNumber: number;
  blockHash: string;
}

export interface VerificationReport {
  documentId: string;
  version: number;
  storedContentHash: string;
  suppliedContentHash: string;
  match: boolean;
  /** The anchor's lifecycle state: prepared | broadcast_sent | broadcast_unknown | confirmed | failed. */
  anchorState: StoredAnchor['status'];
  /** Present only when the supplied content matches AND the anchor is confirmed. */
  proof: AnchorProof | null;
  /** Populated only when the content does not match. */
  differences: ContentDifference[];
}

@Injectable()
export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  /** Issue a new report version. The structured JSON is the source of truth. */
  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    this.canonicalHashOrThrow(content);
    return this.repo.createVersion(documentId, version, content);
  }

  /**
   * Anchor a published report version on the L2.
   *
   * The order is the incident fix:
   *   1. canonical hash of the structured content
   *   2. prepare() — the tx identity exists now, before any broadcast
   *   3. persist the anchor intent (including the tx identity) and commit
   *   4. only then broadcast
   * If the process dies at any point after step 3, recovery has the txId and
   * can ask the chain what happened.
   *
   * broadcast() returning does NOT confirm the anchor: confirmation comes
   * from a receipt, via the confirmation worker and the recovery sweep.
   */
  async anchorDocument(documentId: string, version: number): Promise<StoredAnchor> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const contentHash = this.canonicalHashOrThrow(versionRow.content);

    const prepared = this.chain.prepare({ documentId, version, contentHash });

    // Write-ahead: this commit happens before broadcast, with the tx identity.
    const anchor = await this.repo.createAnchor({
      documentId,
      version,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
    });

    const outcome = await attemptBroadcast(this.chain, anchor.signedTx, this.config.broadcastTimeoutMs);
    await this.repo.transition(anchor.id, ['prepared'], outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown', {
      incrementBroadcastAttempts: true,
    });

    return (await this.repo.findById(anchor.id)) ?? anchor;
  }

  /**
   * Recompute the hash from the supplied content and return either the
   * anchoring proof (txId, block) or a mismatch report that says what differs.
   */
  async verify(documentId: string, version: number, suppliedContent: unknown): Promise<VerificationReport> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const suppliedHash = this.canonicalHashOrThrow(suppliedContent);

    const anchor = await this.repo.findAnchor(documentId, version);
    if (!anchor) throw anchorNotFoundError(documentId, version);

    const match = suppliedHash === anchor.contentHash;

    let proof: AnchorProof | null = null;
    if (match && anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt !== null) {
      proof = { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.receipt.blockHash };
    }

    return {
      documentId,
      version,
      storedContentHash: anchor.contentHash,
      suppliedContentHash: suppliedHash,
      match,
      anchorState: anchor.status,
      proof,
      differences: match ? [] : diffJson(versionRow.content, suppliedContent),
    };
  }

  private canonicalHashOrThrow(content: unknown): string {
    try {
      return canonicalHash(content);
    } catch (error) {
      throw invalidAnchorContentError(error instanceof Error ? error.message : String(error));
    }
  }
}
```

### src/anchoring/anchoring.worker.ts
```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';

const PAGE_SIZE = 100;
const LIMBO_STATES = ['prepared', 'broadcast_unknown'] as const;

/**
 * Confirmation worker + recovery sweep.
 *
 * Confirmation: `broadcast_sent` anchors are polled for a receipt and advanced
 * to `confirmed`/`failed`. Confirmation always comes from a receipt, never
 * from broadcast() returning.
 *
 * Recovery: anchors stuck in broadcast-limbo (`prepared`, `broadcast_unknown`)
 * are resolved by querying the chain FIRST. If a receipt exists, the anchor is
 * confirmed from it — no re-broadcast. Only when the chain has no trace is the
 * SAME signed tx re-broadcast (never a new one, so a re-send cannot become a
 * second anchor).
 */
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** One confirmation pass: poll receipts and advance broadcast-sent anchors. */
  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const advanced = await this.repo.transition(
        row.id,
        ['broadcast_sent'],
        receipt.status === 'success' ? 'confirmed' : 'failed',
        { blockNumber: receipt.blockNumber, receipt },
      );
      if (advanced) {
        this.logger.log(`anchor ${row.id} ${receipt.status === 'success' ? 'confirmed' : 'failed'} at block ${receipt.blockNumber}`);
      }
    }
  }

  /** One recovery pass: resolve anchors stuck in broadcast-limbo, chain first. */
  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck([...LIMBO_STATES], stuckBefore, PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        // The tx landed (e.g. despite a broadcast timeout): confirm from the
        // receipt. Never re-broadcast.
        const advanced = await this.repo.transition(
          row.id,
          [...LIMBO_STATES],
          receipt.status === 'success' ? 'confirmed' : 'failed',
          { blockNumber: receipt.blockNumber, receipt },
        );
        if (advanced) this.logger.log(`recovered anchor ${row.id} from chain receipt, block ${receipt.blockNumber}`);
        continue;
      }
      // No trace on chain: re-broadcast the same signed transaction. (If two
      // workers race, the chain deduplicates by tx identity — one anchor.)
      const outcome = await attemptBroadcast(this.chain, row.signedTx, this.config.broadcastTimeoutMs);
      const advanced = await this.repo.transition(
        row.id,
        [...LIMBO_STATES],
        outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown',
        { incrementBroadcastAttempts: true },
      );
      if (advanced) this.logger.log(`re-broadcast signed tx of anchor ${row.id} (no trace on chain)`);
    }
  }
}
```

### src/anchoring/anchoring.controller.ts
```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { StoredAnchor } from './anchoring.repository.js';
import { AnchoringService } from './anchoring.service.js';
import { validationError } from '../common/domain-exception.js';

@Controller('documents')
export class AnchoringController {
  constructor(private readonly anchoring: AnchoringService) {}

  /** Issue a new report version (structured JSON, the source of truth). */
  @Post(':documentId/versions')
  issueVersion(@Param('documentId') documentId: string, @Body() body: { version?: unknown; content?: unknown } = {}) {
    return this.anchoring.createVersion(
      this.requireDocumentId(documentId),
      this.requireVersion(body.version),
      this.requireContent(body.content),
    );
  }

  /** Anchor a published version on the L2 (write-ahead intent, then broadcast). */
  @Post(':documentId/versions/:version/anchors')
  async createAnchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
  ): Promise<Omit<StoredAnchor, 'signedTx'>> {
    const anchor = await this.anchoring.anchorDocument(this.requireDocumentId(documentId), this.requireVersion(version));
    // The signed tx is internal (re-broadcast material), never exposed by the API.
    const { signedTx: _signedTx, ...visible } = anchor;
    return visible;
  }

  /** Verify supplied content against the anchor: proof or mismatch report. */
  @Post(':documentId/versions/:version/anchors/verifications')
  @HttpCode(200)
  verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown } = {},
  ) {
    return this.anchoring.verify(this.requireDocumentId(documentId), this.requireVersion(version), body.content);
  }

  private requireDocumentId(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw validationError('documentId must be a non-empty string', { documentId: raw ?? null });
    }
    return raw;
  }

  private requireVersion(raw: unknown): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
      throw validationError('version must be a positive integer', { version: raw ?? null });
    }
    return version;
  }

  private requireContent(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw validationError('content must be a JSON object', {});
    }
    return raw as Record<string, unknown>;
  }
}
```

### src/anchoring/anchoring.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchoringController } from './anchoring.controller.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { AnchoringService } from './anchoring.service.js';
import { AnchoringWorker } from './anchoring.worker.js';
import { ANCHORING_CONFIG, anchoringConfigFromEnv } from './anchoring.config.js';
import { CHAIN_CLIENT } from './chain-client.js';
import { InMemoryChainClient } from './in-memory-chain-client.js';

@Module({
  imports: [PrismaModule],
  controllers: [AnchoringController],
  providers: [
    AnchoringService,
    AnchoringRepository,
    AnchoringWorker,
    { provide: ANCHORING_CONFIG, useFactory: anchoringConfigFromEnv },
    // ASSUMPTION: no real L2 client exists in scope ("no real keys and no RPC"),
    // so the in-process implementation is the default provider; a deployment
    // replaces this provider with a real ChainClient.
    { provide: CHAIN_CLIENT, useFactory: () => new InMemoryChainClient() },
  ],
  exports: [AnchoringService],
})
export class AnchoringModule {}
```

### test/anchoring.spec.ts
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { AnchoringConfig } from '../src/anchoring/anchoring.config.js';
import { InMemoryChainClient, InMemoryChainState } from '../src/anchoring/in-memory-chain-client.js';
import { AnchoringRepository, type StoredAnchor } from '../src/anchoring/anchoring.repository.js';
import { AnchoringService } from '../src/anchoring/anchoring.service.js';
import { AnchoringWorker } from '../src/anchoring/anchoring.worker.js';
import { canonicalHash, canonicalize } from '../src/anchoring/canonicalize.js';
import { DomainException } from '../src/common/domain-exception.js';

const CONFIG: AnchoringConfig = {
  broadcastTimeoutMs: 500,
  confirmationPollMs: 0, // no background timers: the passes are driven explicitly
  recoverySweepMs: 0,
  stuckAfterMs: 0, // every limbo row counts as stuck for a test
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('report anchoring (behaviour against the chain-client interface)', () => {
  const prisma = new PrismaService();
  // The chain survives "process restarts"; app state does not.
  const chainState = new InMemoryChainState();
  let repo: AnchoringRepository;
  let chain: InMemoryChainClient;
  let service: AnchoringService;
  let worker: AnchoringWorker;

  /** A fresh app "process": new client/service/worker over the same chain. */
  function makeProcess(): { client: InMemoryChainClient; service: AnchoringService; worker: AnchoringWorker } {
    const client = new InMemoryChainClient(chainState);
    return {
      client,
      service: new AnchoringService(repo, client, CONFIG),
      worker: new AnchoringWorker(repo, client, CONFIG),
    };
  }

  async function issue(documentId: string, version: number, content: Record<string, unknown>): Promise<void> {
    await service.createVersion(documentId, version, content);
  }

  async function waitForAnchor(documentId: string, version: number, timeoutMs = 3000): Promise<StoredAnchor> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await repo.findAnchor(documentId, version);
      if (row) return row;
      if (Date.now() > deadline) throw new Error(`anchor row for ${documentId}#${version} did not appear`);
      await sleep(10);
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    repo = new AnchoringRepository(prisma);
  }, 60_000);

  beforeEach(async () => {
    const p = makeProcess();
    chain = p.client;
    service = p.service;
    worker = p.worker;
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('commits the anchor intent — with the tx identity — before the broadcast returns', async () => {
    await issue('doc-wa', 1, { patient: 'anon-42', result: 'positive', score: 1.5 });

    let release!: () => void;
    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain has accepted the tx
      await new Promise<void>((resolve) => {
        release = resolve;
      }); // ...but broadcast() does not return yet
    });

    const anchorCall = service.anchorDocument('doc-wa', 1);
    anchorCall.catch(() => undefined); // keep a hypothetical failure from surfacing as unhandled

    // While the broadcast is still in flight, the intent must already be
    // committed, with the tx identity a naive (persist-after-broadcast) design
    // would only write later.
    const inFlight = await waitForAnchor('doc-wa', 1);
    expect(inFlight.status).toBe('prepared');
    expect(inFlight.txId).toMatch(/^tx_/);
    expect(inFlight.signedTx).toBe(`signed:${inFlight.txId}`);

    release();
    const anchor = await anchorCall;
    expect(anchor.status).toBe('broadcast_sent');
    expect(anchor.txId).toBe(inFlight.txId);

    const receipt = await chain.getReceipt(inFlight.txId);
    expect(receipt?.txId).toBe(inFlight.txId); // the on-chain tx is the one we persisted
  });

  it('broadcast timeout that landed: recovery confirms from the receipt, no re-broadcast', async () => {
    await issue('doc-to', 3, { a: 1 });

    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain accepted it
      await new Promise<void>(() => {}); // ...and broadcast() never returns (timeout)
    });

    const anchor = await service.anchorDocument('doc-to', 3);
    expect(anchor.status).toBe('broadcast_unknown');
    expect(anchor.txId).toMatch(/^tx_/);

    const broadcastsBefore = chainState.broadcastLog.length; // exactly 1
    await worker.runRecoveryPass(); // chain first: the receipt already exists

    const recovered = await repo.findAnchor('doc-to', 3);
    expect(recovered?.status).toBe('confirmed');
    expect(recovered?.blockNumber).toBeTypeOf('number');
    expect(recovered?.txId).toBe(anchor.txId);
    expect(chainState.broadcastLog.length).toBe(broadcastsBefore); // no re-broadcast
    expect(await prisma.anchor.count({ where: { documentId: 'doc-to', version: 3 } })).toBe(1);
  });

  it('broadcast timeout that did not land: the same signed tx is re-broadcast, one anchor results', async () => {
    await issue('doc-nl', 1, { a: 1 });

    chain.setBroadcast(() => new Promise<void>(() => {})); // hang, and nothing lands
    const anchor = await service.anchorDocument('doc-nl', 1);
    expect(anchor.status).toBe('broadcast_unknown');

    chain.setBroadcast(null); // the chain is back to normal for the recovery pass

    await worker.runRecoveryPass(); // no receipt on chain -> re-broadcast the SAME signed tx
    const afterRebroadcast = await repo.findAnchor('doc-nl', 1);
    expect(afterRebroadcast?.status).toBe('broadcast_sent');
    expect(chainState.broadcastLog).toEqual([anchor.signedTx, anchor.signedTx]);

    await worker.runConfirmationPass();
    const confirmed = await repo.findAnchor('doc-nl', 1);
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.txId).toBe(anchor.txId);
    expect(await prisma.anchor.count({ where: { documentId: 'doc-nl', version: 1 } })).toBe(1);
  });

  it('process crash between broadcast and confirmation: restart recovers exactly one anchor', async () => {
    await issue('doc-cr', 7, { b: [1, 2, 3] });

    // The chain accepts the tx, then the process dies before any post-broadcast
    // state write. A real SIGKILL would leave the row 'prepared'; this
    // simulation leaves it 'broadcast_unknown' — both are limbo states the
    // recovery sweep resolves by asking the chain first, using the write-ahead
    // tx identity that a persist-after-broadcast design would not have.
    chain.setBroadcast((_signedTx, txId, state) => {
      state.land(txId);
      throw new Error('simulated process crash');
    });

    const anchor = await service.anchorDocument('doc-cr', 7);
    expect(anchor.status).toBe('broadcast_unknown');
    const txId = anchor.txId;

    // "Restart": fresh process state, same chain (the chain keeps the tx).
    const { worker: restartedWorker } = makeProcess();
    await restartedWorker.runRecoveryPass();

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-cr', version: 7 } });
    expect(rows).toHaveLength(1); // one anchor, total
    expect(rows[0].status).toBe('CONFIRMED');
    expect(rows[0].txId).toBe(txId); // one transaction identity
    expect(chainState.broadcastLog.length).toBe(1); // broadcast exactly once, in total
  });

  it('anchoring the same (document, version) twice is rejected by the database', async () => {
    await issue('doc-uq', 2, { x: true });

    const [first, second] = await Promise.allSettled([
      service.anchorDocument('doc-uq', 2),
      service.anchorDocument('doc-uq', 2),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(DomainException);
    expect((rejected[0].reason as DomainException).code).toBe('anchor_conflict');

    // A third attempt, after the first is confirmed, is rejected the same way.
    await worker.runConfirmationPass();
    await expect(service.anchorDocument('doc-uq', 2)).rejects.toMatchObject({ code: 'anchor_conflict', httpStatus: 409 });

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-uq', version: 2 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].txId).toBeTruthy();
  });

  describe('verify', () => {
    it('returns the on-chain proof for matching content (key order does not matter)', async () => {
      const content = { report: { patient: 'anon-1', values: [1, 2.5, 'ok'] }, issued: '2025-01-01' };
      await issue('doc-vf', 5, content);
      await service.anchorDocument('doc-vf', 5);
      await worker.runConfirmationPass();

      const row = await repo.findAnchor('doc-vf', 5);
      expect(row?.status).toBe('confirmed');

      const report = await service.verify('doc-vf', 5, {
        issued: '2025-01-01',
        report: { values: [1, 2.5, 'ok'], patient: 'anon-1' },
      });
      expect(report.match).toBe(true);
      expect(report.differences).toEqual([]);
      expect(report.anchorState).toBe('confirmed');
      expect(report.proof).toEqual({
        txId: row?.txId,
        blockNumber: row?.blockNumber,
        blockHash: row?.receipt?.blockHash,
      });
    });

    it('returns a mismatch report that says what differs', async () => {
      const content = { patient: 'anon-9', labs: { hgb: 12.5, wbc: 6.1 }, flags: [] };
      await issue('doc-mm', 1, content);
      await service.anchorDocument('doc-mm', 1);
      await worker.runConfirmationPass();

      const tampered = { patient: 'ANON-9', labs: { hgb: 13.0, wbc: 6.1 }, flags: ['review'], extra: 1 };
      const report = await service.verify('doc-mm', 1, tampered);

      expect(report.match).toBe(false);
      expect(report.storedContentHash).not.toBe(report.suppliedContentHash);
      expect(report.proof).toBeNull(); // no proof is served for content that does not match

      const byPath = new Map(report.differences.map((d) => [d.path, d]));
      expect(byPath.get('$.patient')?.kind).toBe('value');
      expect(byPath.get('$.patient')?.stored).toBe('anon-9');
      expect(byPath.get('$.patient')?.supplied).toBe('ANON-9');
      expect(byPath.get('$.labs.hgb')?.kind).toBe('value');
      expect(byPath.get('$.labs.hgb')?.stored).toBe(12.5);
      expect(byPath.get('$.labs.hgb')?.supplied).toBe(13);
      expect(byPath.get('$.labs.wbc')).toBeUndefined(); // unchanged fields are not reported
      expect(byPath.get('$.flags[0]')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.supplied).toBe(1);
    });

    it('reports pending anchors (matching content, no block yet) and rejects unknown versions/anchors', async () => {
      chain.setBroadcast(() => new Promise<void>(() => {})); // the anchor will never confirm
      await issue('doc-pd', 1, { a: 1 });
      await service.anchorDocument('doc-pd', 1);

      const pending = await service.verify('doc-pd', 1, { a: 1 });
      expect(pending.match).toBe(true);
      expect(pending.anchorState).toBe('broadcast_unknown');
      expect(pending.proof).toBeNull();

      await expect(service.anchorDocument('ghost', 1)).rejects.toMatchObject({
        code: 'document_version_not_found',
        httpStatus: 404,
      });
      await expect(service.verify('ghost', 1, { a: 1 })).rejects.toMatchObject({
        code: 'document_version_not_found',
      });

      await issue('doc-na', 1, { a: 1 });
      await expect(service.verify('doc-na', 1, { a: 1 })).rejects.toMatchObject({
        code: 'anchor_not_found',
        httpStatus: 404,
      });
    });
  });

  describe('canonicalization (per docs/canonicalization.md)', () => {
    it('is key-order insensitive and number-normalizing', () => {
      expect(canonicalize({ b: 1, a: { d: 2, c: [true, null] } })).toBe('{"a":{"c":[true,null],"d":2},"b":1}');
      expect(canonicalHash({ b: 1, a: { c: [true, null], d: 2 } })).toBe(canonicalHash({ a: { d: 2, c: [true, null] }, b: 1 }));
      expect(canonicalHash({ n: 1.1, m: 1e2 })).toBe(canonicalHash({ n: 1.1, m: 100 }));
      expect(canonicalize({ s: 'x"y' })).toBe('{"s":"x\\"y"}');
      expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects non-JSON values and drops undefined-valued keys', () => {
      expect(() => canonicalize({ bad: Number.NaN })).toThrow();
      expect(canonicalize({ a: 1, gone: undefined })).toBe('{"a":1}');
    });
  });
});
```

### test/anchoring.api.spec.ts
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AnchoringModule } from '../src/anchoring/anchoring.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

describe('anchoring HTTP API (error envelope + flow)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    // Keep the background worker from interfering with these assertions.
    process.env.ANCHORING_CONFIRMATION_POLL_MS = '3600000';
    process.env.ANCHORING_RECOVERY_SWEEP_MS = '3600000';
    process.env.ANCHORING_STUCK_AFTER_MS = '3600000';

    const moduleRef = await Test.createTestingModule({ imports: [AnchoringModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    base = app.getUrl();

    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
  }, 60_000);

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await app.close();
  });

  it('rejects a malformed version with the standard 400 envelope', async () => {
    const res = await fetch(`${base}/documents/doc-x/versions/not-an-int/anchors`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('validation_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual(expect.any(Object));
    expect(body.error.details.version).toBe('not-an-int');
  });

  it('reports a document version that was never issued with 404', async () => {
    const res = await fetch(`${base}/documents/ghost-doc/versions/1/anchors`, { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('document_version_not_found');
    expect(body.error.details).toMatchObject({ documentId: 'ghost-doc', version: 1 });
  });

  it('issues a version, anchors it, verifies a mismatch — all through the API', async () => {
    const content = { patient: 'anon-7', labs: { hgb: 12.5 } };

    const issued = await fetch(`${base}/documents/doc-http/versions/1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, content }),
    });
    expect(issued.status).toBe(201);

    const anchored = await fetch(`${base}/documents/doc-http/versions/1/anchors`, { method: 'POST' });
    expect(anchored.status).toBe(201);
    const anchor = (await anchored.json()) as {
      documentId: string;
      version: number;
      status: string;
      txId: string;
      signedTx?: string;
    };
    expect(anchor.documentId).toBe('doc-http');
    expect(anchor.version).toBe(1);
    expect(anchor.status).toBe('broadcast_sent');
    expect(anchor.txId).toMatch(/^tx_/);
    expect(anchor.signedTx).toBeUndefined(); // the signed tx is never exposed by the API

    const tampered = { patient: 'anon-7', labs: { hgb: 99.9 } };
    const verified = await fetch(`${base}/documents/doc-http/versions/1/anchors/verifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: tampered }),
    });
    expect(verified.status).toBe(200);
    const report = (await verified.json()) as {
      match: boolean;
      anchorState: string;
      differences: Array<{ path: string }>;
      proof: unknown;
    };
    expect(report.match).toBe(false);
    expect(report.anchorState).toBe('broadcast_sent');
    expect(report.proof).toBeNull();
    expect(report.differences.map((d) => d.path)).toContain('$.labs.hgb');

    const reanchored = await fetch(`${base}/documents/doc-http/versions/1/anchors`, { method: 'POST' });
    expect(reanchored.status).toBe(409);
    const conflict = (await reanchored.json()) as ErrorEnvelope;
    expect(conflict.error.code).toBe('anchor_conflict');
  });
});
```


---

# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/anchoring/anchoring.repository.ts(2,32)`: `PrismaClientKnownRequestError` is not exported from `@prisma/client`. In newer versions of Prisma, it's exported from `@prisma/client/runtime/library` or `@prisma/client/runtime`. Actually, looking at this more carefully, in Prisma 5+, `PrismaClientKnownRequestError` is still available from `@prisma/client`. But in some versions/configurations, it might be from `@prisma/client/runtime/library`. Let me think about what's correct here.

Actually, in Prisma, `PrismaClientKnownRequestError` is exported from `@prisma/client`. But in some versions (particularly with the new Prisma Client generator or certain ESM configurations), it might not be directly available. The alternative is to use `Prisma.PrismaClientKnownRequestError` which is always available as a property of the `Prisma` namespace.

So the fix is to import `Prisma` (which is already imported) and use `Prisma.PrismaClientKnownRequestError` instead of the direct import.

2. `src/anchoring/anchoring.repository.ts(75,60)`: `'error' is of type 'unknown'`. This is the `error` in the catch block of `createVersion`. In TypeScript strict mode, catch variables are `unknown` by default (with `useUnknownInCatchVariables`). The code does `if (isUniqueViolation(error))` which should work since `isUniqueViolation` takes `unknown`. Wait, let me re-read the error. Line 75, column 60. Let me count the lines...

Actually wait, looking at the code more carefully:

```typescript
async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.document.upsert({ where: { id: documentId }, update: {}, create: { id: documentId } });
        await tx.documentVersion.create({ data: { documentId, version, content: content as Prisma.InputJsonValue } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw documentVersionConflictError(documentId, version);
      throw error;
    }
```

The `isUniqueViolation` function takes `unknown`, so passing `error` (which is `unknown`) should be fine. But wait - the error is at line 75, column 60. Let me think about what's on that line.

Actually, I need to recount. The file starts with imports. Let me count more carefully...

Actually, the error says `'error' is of type 'unknown'` at line 75, column 60. This might be in the `createAnchor` method where `error.code` is accessed. Wait no, `isUniqueViolation` uses `instanceof` check which should work with `unknown`.

Hmm, let me reconsider. The `isUniqueViolation` function is:
```typescript
function isUniqueViolation(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';
}
```

If `PrismaClientKnownRequestError` import fails (error 1), then the `instanceof` check would fail type-checking because the type doesn't exist. But that's error 1's problem.

Wait, actually if we fix error 1 by using `Prisma.PrismaClientKnownRequestError`, then `isUniqueViolation` would work fine with `unknown`.

But the error at line 75 col 60 is a separate issue. Let me think about what's at that position. If I count lines in the file:

Line 1: `import { Injectable } from '@nestjs/common';`
Line 2: `import { AnchorStatus, Prisma, PrismaClientKnownRequestError } from '@prisma/client';`
Line 3: `import { PrismaService } from '../prisma/prisma.service.js';`
Line 4: `import { anchorConflictError, documentVersionConflictError } from '../common/domain-exception.js';`
Line 5: (empty)
Line 6: `/** Anchor lifecycle states... */`
Line 7: `export type AnchorState = ...`
Line 8: (empty)
Line 9: `export interface ChainReceiptRecord {`
Line 10: `  txId: string;`
Line 11: `  blockNumber: number;`
Line 12: `  blockHash: string;`
Line 13: `  status: 'success' | 'failure';`
Line 14: `}`
Line 15: (empty)
Line 16: `export interface StoredVersion {`
Line 17: `  id: string;`
Line 18: `  documentId: string;`
Line 19: `  version: number;`
Line 20: `  content: unknown;`
Line 21: `  createdAt: Date;`
Line 22: `}`
Line 23: (empty)
Line 24: `export interface StoredAnchor {`
Line 25: `  id: string;`
Line 26: `  documentId: string;`
Line 27: `  version: number;`
Line 28: `  status: AnchorState;`
Line 29: `  contentHash: string;`
Line 30: `  txId: string;`
Line 31: `  signedTx: string;`
Line 32: `  blockNumber: number | null;`
Line 33: `  receipt: ChainReceiptRecord | null;`
Line 34: `  broadcastAttempts: number;`
Line 35: `  createdAt: Date;`
Line 36: `  updatedAt: Date;`
Line 37: `}`
Line 38: (empty)
Line 39: `const TO_DB: Record<AnchorState, AnchorStatus> = {`
Line 40: `  prepared: AnchorStatus.PREPARED,`
Line 41: `  broadcast_sent: AnchorStatus.BROADCAST_SENT,`
Line 42: `  broadcast_unknown: AnchorStatus.BROADCAST_UNKNOWN,`
Line 43: `  confirmed: AnchorStatus.CONFIRMED,`
Line 44: `  failed: AnchorStatus.FAILED,`
Line 45: `};`
Line 46: (empty)
Line 47: `const TO_STATE: Record<AnchorStatus, AnchorState> = {`
Line 48: `  [AnchorStatus.PREPARED]: 'prepared',`
Line 49: `  [AnchorStatus.BROADCAST_SENT]: 'broadcast_sent',`
Line 50: `  [AnchorStatus.BROADCAST_UNKNOWN]: 'broadcast_unknown',`
Line 51: `  [AnchorStatus.CONFIRMED]: 'confirmed',`
Line 52: `  [AnchorStatus.FAILED]: 'failed',`
Line 53: `};`
Line 54: (empty)
Line 55: `type AnchorRow = Prisma.AnchorGetPayload<{}>;`
Line 56: (empty)
Line 57: `function toStoredAnchor(row: AnchorRow): StoredAnchor {`
Line 58: `  return {`
Line 59: `    id: row.id,`
Line 60: `    documentId: row.documentId,`
Line 61: `    version: row.version,`
Line 62: `    status: TO_STATE[row.status],`
Line 63: `    contentHash: row.contentHash,`
Line 64: `    txId: row.txId,`
Line 65: `    signedTx: row.signedTx,`
Line 66: `    blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),`
Line 67: `    receipt: (row.receipt ?? null) as ChainReceiptRecord | null,`
Line 68: `    broadcastAttempts: row.broadcastAttempts,`
Line 69: `    createdAt: row.createdAt,`
Line 70: `    updatedAt: row.updatedAt,`
Line 71: `  };`
Line 72: `}`
Line 73: (empty)
Line 74: `function isUniqueViolation(error: unknown): boolean {`
Line 75: `  return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';`
Line 76: `}`

So line 75 is `return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';`

The error is at column 60, which would be around `error.code`. The issue is that `error` is `unknown`, and even after the `instanceof` check, TypeScript might not narrow it properly if `PrismaClientKnownRequestError` is not properly imported (because of error 1). 

Actually wait - if `PrismaClientKnownRequestError` is not a valid export, then the `instanceof` expression itself is an error (error 1 covers the import). But the type narrowing from `instanceof` requires the right-hand side to be a constructor. If the import fails, the type system can't use it for narrowing, so `error.code` on line 75 would fail because `error` is still `unknown`.

So if I fix error 1 (use `Prisma.PrismaClientKnownRequestError`), then error 2 should also be fixed because `instanceof Prisma.PrismaClientKnownRequestError` will properly narrow the type.

Wait, but `Prisma.PrismaClientKnownRequestError` - is that valid? In Prisma, the `Prisma` namespace does export `PrismaClientKnownRequestError`. Let me check: yes, `Prisma.PrismaClientKnownRequestError` is the standard way to access it in many Prisma versions, especially when the direct export might not work with certain ESM configurations.

Actually, looking at this more carefully - in Prisma 5.x with the `prisma-client-js` generator, `PrismaClientKnownRequestError` IS exported from `@prisma/client` directly. But there might be version-specific issues.

The safest fix that works across versions is to use `Prisma.PrismaClientKnownRequestError` since `Prisma` is already imported and is definitely available.

3. `src/anchoring/anchoring.repository.ts(166,53)`: Conversion of `ChainReceiptRecord` to `InputJsonValue`. The issue is that `ChainReceiptRecord` is an interface, and TypeScript doesn't allow direct conversion of an interface to `InputJsonValue` because interfaces don't have index signatures. The fix is to cast through `unknown` first: `extra.receipt as unknown as Prisma.InputJsonValue`.

4. `src/anchoring/anchoring.worker.ts(45,10)`: Cannot assign to 'timers' because it is a read-only property. The line is `this.timers = [];` in `onModuleDestroy`. The fix is to use `this.timers.length = 0` or `this.timers.splice(0)` instead of reassigning.

Wait, let me look at the worker code again:
```typescript
private readonly timers: NodeJS.Timeout[] = [];
```

It's declared as `readonly`, so you can't reassign it. The fix in `onModuleDestroy` is to clear it without reassignment:
```typescript
onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
}
```

Now let me summarize the distinct mistakes:

1. **Import error**: `PrismaClientKnownRequestError` not directly exported from `@prisma/client`. Fix: use `Prisma.PrismaClientKnownRequestError` instead. This affects the import line and the usage in `isUniqueViolation`. This also fixes error 2 (the `unknown` type error) because proper narrowing will work.

2. **Type conversion**: `ChainReceiptRecord` can't be cast directly to `Prisma.InputJsonValue`. Fix: cast through `unknown`.

3. **Readonly assignment**: `this.timers = []` on a readonly property. Fix: use `this.timers.length = 0`.

So I need to change two files:
- `src/anchoring/anchoring.repository.ts` (errors 1, 2, 3)
- `src/anchoring/anchoring.worker.ts` (error 4)

Let me write the fixed files.

For `anchoring.repository.ts`:
- Remove `PrismaClientKnownRequestError` from the import (keep `AnchorStatus` and `Prisma`)
- Change `isUniqueViolation` to use `Prisma.PrismaClientKnownRequestError`
- Change the receipt cast to go through `unknown`

For `anchoring.worker.ts`:
- Change `this.timers = []` to `this.timers.length = 0`

Let me write out the complete files.
```

## reply

Looking at the four errors, I see three distinct mistakes:

1. **`PrismaClientKnownRequestError` not directly exported** — use `Prisma.PrismaClientKnownRequestError` instead. This also resolves the `unknown` narrowing error on line 75 (the `instanceof` check can't narrow without a valid constructor).
2. **`ChainReceiptRecord` → `InputJsonValue` cast** — needs to go through `unknown` because an interface lacks the required index signature.
3. **Assignment to `readonly timers`** — use `.length = 0` instead of reassignment.

### src/anchoring/anchoring.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { AnchorStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { anchorConflictError, documentVersionConflictError } from '../common/domain-exception.js';

/** Anchor lifecycle states (the schema enum; DB values are snake_case). */
export type AnchorState = 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed';

export interface ChainReceiptRecord {
  txId: string;
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface StoredVersion {
  id: string;
  documentId: string;
  version: number;
  content: unknown;
  createdAt: Date;
}

export interface StoredAnchor {
  id: string;
  documentId: string;
  version: number;
  status: AnchorState;
  contentHash: string;
  txId: string;
  signedTx: string;
  blockNumber: number | null;
  receipt: ChainReceiptRecord | null;
  broadcastAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const TO_DB: Record<AnchorState, AnchorStatus> = {
  prepared: AnchorStatus.PREPARED,
  broadcast_sent: AnchorStatus.BROADCAST_SENT,
  broadcast_unknown: AnchorStatus.BROADCAST_UNKNOWN,
  confirmed: AnchorStatus.CONFIRMED,
  failed: AnchorStatus.FAILED,
};

const TO_STATE: Record<AnchorStatus, AnchorState> = {
  [AnchorStatus.PREPARED]: 'prepared',
  [AnchorStatus.BROADCAST_SENT]: 'broadcast_sent',
  [AnchorStatus.BROADCAST_UNKNOWN]: 'broadcast_unknown',
  [AnchorStatus.CONFIRMED]: 'confirmed',
  [AnchorStatus.FAILED]: 'failed',
};

type AnchorRow = Prisma.AnchorGetPayload<{}>;

function toStoredAnchor(row: AnchorRow): StoredAnchor {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    status: TO_STATE[row.status],
    contentHash: row.contentHash,
    txId: row.txId,
    signedTx: row.signedTx,
    blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),
    receipt: (row.receipt ?? null) as ChainReceiptRecord | null,
    broadcastAttempts: row.broadcastAttempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** The only layer that touches the database. All Prisma calls live here. */
@Injectable()
export class AnchoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVersion(documentId: string, version: number): Promise<StoredVersion | null> {
    const row = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    if (!row) return null;
    return { id: row.id, documentId: row.documentId, version: row.version, content: row.content, createdAt: row.createdAt };
  }

  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.document.upsert({ where: { id: documentId }, update: {}, create: { id: documentId } });
        await tx.documentVersion.create({ data: { documentId, version, content: content as Prisma.InputJsonValue } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw documentVersionConflictError(documentId, version);
      throw error;
    }
    const created = await this.findVersion(documentId, version);
    if (!created) throw new Error('createVersion: version row missing after commit');
    return created;
  }

  async createAnchor(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<StoredAnchor> {
    try {
      const row = await this.prisma.anchor.create({ data: { ...data, status: AnchorStatus.PREPARED } });
      return toStoredAnchor(row);
    } catch (error) {
      // One anchor per (document, version): the unique constraint is the enforcement.
      if (isUniqueViolation(error)) throw anchorConflictError(data.documentId, data.version);
      throw error;
    }
  }

  async findAnchor(documentId: string, version: number): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? toStoredAnchor(row) : null;
  }

  async findById(id: string): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({ where: { id } });
    return row ? toStoredAnchor(row) : null;
  }

  async listByStatuses(states: AnchorState[], limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  async listStuck(states: AnchorState[], stuckBefore: Date, limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) }, updatedAt: { lt: stuckBefore } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  /**
   * Atomic compare-and-set transition: only succeeds if the row is still in
   * one of `from` states. Returns false when a concurrent worker already
   * moved it, so two instances cannot double-advance or double-confirm.
   */
  async transition(
    id: string,
    from: AnchorState[],
    to: AnchorState,
    extra: { blockNumber?: number; receipt?: ChainReceiptRecord; incrementBroadcastAttempts?: boolean } = {},
  ): Promise<boolean> {
    const data: Prisma.AnchorUpdateManyMutationInput = { status: TO_DB[to] };
    if (extra.blockNumber !== undefined) data.blockNumber = BigInt(extra.blockNumber);
    if (extra.receipt !== undefined) data.receipt = extra.receipt as unknown as Prisma.InputJsonValue;
    if (extra.incrementBroadcastAttempts) data.broadcastAttempts = { increment: 1 };
    const result = await this.prisma.anchor.updateMany({
      where: { id, status: { in: from.map((s) => TO_DB[s]) } },
      data,
    });
    return result.count > 0;
  }
}
```

### src/anchoring/anchoring.worker.ts
```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';

const PAGE_SIZE = 100;
const LIMBO_STATES = ['prepared', 'broadcast_unknown'] as const;

/**
 * Confirmation worker + recovery sweep.
 *
 * Confirmation: `broadcast_sent` anchors are polled for a receipt and advanced
 * to `confirmed`/`failed`. Confirmation always comes from a receipt, never
 * from broadcast() returning.
 *
 * Recovery: anchors stuck in broadcast-limbo (`prepared`, `broadcast_unknown`)
 * are resolved by querying the chain FIRST. If a receipt exists, the anchor is
 * confirmed from it — no re-broadcast. Only when the chain has no trace is the
 * SAME signed tx re-broadcast (never a new one, so a re-send cannot become a
 * second anchor).
 */
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /** One confirmation pass: poll receipts and advance broadcast-sent anchors. */
  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const advanced = await this.repo.transition(
        row.id,
        ['broadcast_sent'],
        receipt.status === 'success' ? 'confirmed' : 'failed',
        { blockNumber: receipt.blockNumber, receipt },
      );
      if (advanced) {
        this.logger.log(`anchor ${row.id} ${receipt.status === 'success' ? 'confirmed' : 'failed'} at block ${receipt.blockNumber}`);
      }
    }
  }

  /** One recovery pass: resolve anchors stuck in broadcast-limbo, chain first. */
  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck([...LIMBO_STATES], stuckBefore, PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        // The tx landed (e.g. despite a broadcast timeout): confirm from the
        // receipt. Never re-broadcast.
        const advanced = await this.repo.transition(
          row.id,
          [...LIMBO_STATES],
          receipt.status === 'success' ? 'confirmed' : 'failed',
          { blockNumber: receipt.blockNumber, receipt },
        );
        if (advanced) this.logger.log(`recovered anchor ${row.id} from chain receipt, block ${receipt.blockNumber}`);
        continue;
      }
      // No trace on chain: re-broadcast the same signed transaction. (If two
      // workers race, the chain deduplicates by tx identity — one anchor.)
      const outcome = await attemptBroadcast(this.chain, row.signedTx, this.config.broadcastTimeoutMs);
      const advanced = await this.repo.transition(
        row.id,
        [...LIMBO_STATES],
        outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown',
        { incrementBroadcastAttempts: true },
      );
      if (advanced) this.logger.log(`re-broadcast signed tx of anchor ${row.id} (no trace on chain)`);
    }
  }
}
```


---

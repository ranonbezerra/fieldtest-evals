# solution

## reasoning

```
We need to implement a solution that satisfies the requirements described: anchorDocument, verification, confirmation worker, recovery sweep, schema constraints, tests. There's no existing code base shown except for the conventions: we have a typical NestJS project layout.

Given we have to produce all needed files: prisma schema, main app, modules, controllers, services, repositories, workers (maybe using NestJS schedule), tests, and a fake chain client for tests.

We need to follow the conventions: each layer's responsibilities.

We need to define a canonical hash function for JSON content. We need to describe the canonicalization somewhere; maybe as a comment in the service or repository. The description must be part of the deliverable? The problem states "write down canonicalization — key ordering, number formatting, whitespace, encoding — write it down, and hash the canonical bytes. An auditor in four years reproduces this from your description, so it has to be stated, not merely implemented." So we need to document it, maybe in a README or a comment. But the deliverables are code files. We can include the description in comments near the hashing function. That should satisfy.

Now about the schema. We need a model for DocumentAnchor, perhaps.

We have Document (maybe not needed). At least we need to track anchor per documentId and version. Since documentId is presumably a UUID referencing a document entity stored elsewhere. But we only need to track anchor records.

We need fields:

- id (auto)
- documentId (string) or maybe UUID.
- version (int)
- hash (string) hex of canonical hash.
- txId (string) (the transaction identity from prepare)
- signedTx (string) (maybe needed for re-broadcast)
- state (enum): prepared, broadcasted, receipt_pending (or sent, unknown?), confirmed, failed.
- blockNumber (int) maybe for proof
- createdAt, updatedAt

Unique constraint on (documentId, version).

We need an enum type for anchor_state.

Now we need a repository for DB operations: find anchor by documentId/version, create anchor, update state, etc.

The service layer will contain anchorDocument and verify logic. The controller for exposing endpoints: anchor (POST), verify (POST? GET?).

The worker: a background job that polls for anchors with broadcast-sent (or broadcasted but not confirmed) state, fetches receipt, updates state. Also a recovery sweep that queries getReceipt for anchors stuck in broadcast-sent (or unknown) after broadcast call timed out. But since we have no real broadcast call timeouts in test we can simulate.

Probably we need a separate service for confirmation worker; could be implemented using NestJS schedule (Cron) or simple interval.

Simplify: implement a ConfirmationService that has a method processPendingAnchors that fetches anchors in state "broadcasted" or "broadcast_unknown" and calls chainClient.getReceipt(txId). If receipt exists, update anchor to confirmed (store block number). If receipt not found, we need to re-broadcast the signedTx (the same signedTx). In that case we call broadcast again and maybe keep state unchanged? But after broadcasting we may still be unknown. But we should update something like "broadcasted" state again. We'll simplify: if receipt not found, call broadcast again, and keep state as "broadcasted". If receipt is found but indicates failure, maybe set failed.

We also need to simulate chain client with a fake for tests. We'll define an interface IChainClient with methods prepare, broadcast, getReceipt. The fake implementation will store prepared transactions in memory and broadcast will optionally simulate timeout (i.e., not resolve? In tests we can simulate by returning a promise that resolves after a delay but we can cause a thrown error?). But we need a deterministic way to simulate broadcast timeout and later receipt retrieval. For tests we can control the fake's behavior via injection.

The spec: "No real keys or RPC: implement against the interface with a fake for tests." So we can define a fake chain client that uses an in-memory map of txId->receipt (blockNumber, status). The prepare returns txId (some uuid) and signedTx (maybe JSON string). broadcast may either resolve (simulate successful broadcast) or simulate timeout (throw an error? maybe reject). But the spec says broadcast may time out with unknown outcome. So we can have broadcast that optionally throws an error (or returns undefined?) and we have to treat that as unknown. So anchorDocument should call broadcast within a try-catch; on success, set state to broadcasted; on error (timeout), set state to broadcast_unknown.

But the spec says we must persist the anchor intent BEFORE broadcasting, committing the transaction. So we need to create the anchor row (with txId, signedTx, state = prepared) and commit before broadcast. This can be done by repository method: createAnchorIntent(documentId, version, hash, txId, signedTx, state). Then broadcast. If broadcast succeeds, we update state to broadcasted; if broadcast fails (throws), we update state to broadcast_unknown (unknown). But the spec wants "broadcast-sent is not confirmed, and neither is unknown" distinct states. So we need a state for broadcasted (sent but unknown receipt), and for broadcast_unknown (broadcast attempted but unknown outcome). Hmm maybe we can have states: PREPARED (before broadcast), BROADCASTED (broadcast succeeded, no receipt yet), BROADCAST_UNKNOWN (broadcast timed out), CONFIRMED, FAILED.

But the spec says "broadcast-sent is not confirmed, and neither is unknown" - they want distinct states: broadcast-sent, unknown (timeout). So we can define:

enum AnchorState {
  PREPARED = 'prepared',
  BROADCAST_SENT = 'broadcast_sent',
  BROADCAST_UNKNOWN = 'broadcast_unknown',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

Now flow:

anchorDocument:

- Retrieve content (maybe passed as param). The function signature is anchorDocument(documentId, version). But we need to compute hash from the structured content; the structured content is stored somewhere else (not part of this code). The spec says "computes a canonical hash of the structured content (define the canonicalization; the PDF is a rendering, not the source of truth)". The function receives documentId, version, maybe content? But spec says anchorDocument(documentId, version). So we need to retrieve the content from somewhere? Not defined. For test we can provide content externally (maybe a service can supply it). Simplify: In anchorDocument we can accept an extra argument "content" to compute hash. But spec defined signature as two arguments only. But we can decide to also pass content. However we must adhere to spec: they said anchorDocument(documentId, version) — compute canonical hash of structured content (define). Perhaps we can load content from DB? Not defined. Perhaps the system already has Document entity and content stored; we can assume a DocumentRepository that can fetch content. But not required for this task; we can simulate by passing content as a parameter. The test can call anchorDocument with some content. Maybe we can change signature to include content and still satisfy spec? Better not diverge; keep signature: anchorDocument(documentId: string, version: number, content: any). But the spec says exactly anchorDocument(documentId, version) — maybe they omitted content for brevity. In implementation we can have a third param; but this would be a deviation. However typical anchor functions need content to compute hash; they might fetch the content from elsewhere. Since we don't have a Document entity, we can add it to repository. However test may be expecting to call anchorDocument with content param. Hard to guess.

Alternative: We can define an AnchorDocumentDto with documentId, version, content. Then controller's POST body includes these fields, and service's method anchorDocument receives that DTO. That matches typical NestJS pattern. The spec may be flexible.

Ok.

Now verify(documentId, version, content) must recompute hash and compare with stored anchor hash. If mismatch, return error with details indicating mismatch. If match, return proof: txId, blockNumber.

We need to define error envelope.

Define a standard error response class and exception filter? Simpler: service can throw HttpException with envelope.

Better: Create a custom exception that extends HttpException, with shape {error: {...}}.

But we can also in controller catch errors and format.

Simplify: Use Nest's built-in HttpException, but pass as message the envelope JSON? Not ideal.

The spec says "Exactly one anchor per (document, version), enforced at the schema level, and proven by a test that crashes the process between broadcast and the (wrong) late persist a naive design would do."

So we need to have a unique constraint in Prisma schema: @@unique([documentId, version]).

Now tests need to simulate a process crash between broadcast and the naive design's later persist. In our design we persist intent before broadcast, so crash after broadcast may lead to unknown state but anchor row already exists. In test we can simulate this by calling anchorDocument, but we need to simulate a crash after broadcast returns but before we update state (if naive design). But our design updates state after broadcast; we need to test that after crash, the recovery sweep only confirms the anchor and does not duplicate. We'll need to simulate by calling anchorDocument, then simulate crash by not calling the state update (i.e., we can mock broadcast to throw a "TimeoutError" and ensure that anchor row is persisted with state prepared and we later run recovery which queries getReceipt and if receipt exists, updates to confirmed. We'll need to set up the fake chain client to store receipt after broadcast (maybe broadcast returns but we simulate timeout before DB commit? But we can't cause crash mid-process in code; we can simulate by calling anchorDocument which persists intent, then we manually call broadcast via service but not update DB. Hmm.

Better: In test, we can simulate that broadcast timed out but the transaction succeeded. In our code, after persisting intent we call broadcast within a try-catch. If broadcast throws (timeout) we consider unknown state. But we need to simulate scenario where broadcast timed out but transaction succeeded. That is, the chain client returns a receipt later when getReceipt is called. So we can have broadcast that throws a TimeoutError (simulate time out) but the transaction is considered "sent" and recorded in the client. Since the broadcast function may not have returned, but the client has internally recorded that the transaction was broadcast (maybe because broadcast method in the fake does the actual sending before throwing). In our fake, broadcast can store the transaction in a "sent" list and then throw a timeout error.

Thus after anchorDocument returns (maybe with unknown state), we can run the recovery sweep (which calls getReceipt). Since the transaction was actually sent, getReceipt will return receipt and then we will update state to confirmed.

The test needs to verify that no duplicate anchors are persisted: only one anchor row for that doc/version exists.

Now the unique constraint ensures that if we try to anchor the same document/version again, we get a Prisma error (unique constraint violation). In test we assert that this error is thrown.

Also we need a test that simulates broadcast timed out and transaction didn't land (no receipt). In this case, recovery sweep will not find receipt; it will re-broadcast the same signedTx (the same txId). The client will treat broadcast again but should not create duplicate transaction; maybe same txId is reused; re-broadcast should be idempotent. For the test, we can verify that after re-broadcast, eventually getReceipt returns receipt (maybe we set the fake client to produce receipt after second broadcast). And there is only one anchor row.

Now about the confirmation worker: It polls receipts for anchors in broadcast_sent (unknown receipt) and updates state.

We can implement a service called AnchorConfirmationService that runs an interval every e.g., 5 seconds (but in test we can call the method directly). Use @Injectable and @Cron from '@nestjs/schedule', but we need to add ScheduleModule to imports.

Alternatively we can expose a method that can be called manually.

For recovery sweep: We can have a method runRecoverySweep that queries anchors in broadcast_unknown state, and checks getReceipt first.

Now about modules: We need an AnchorModule with controller, service, repository, maybe worker services. Import the PrismaModule (which provides PrismaClient). Use Nest's dependency injection.

We need to provide a Prisma service or use PrismaClient directly. Typically we create a PrismaService that extends PrismaClient and is injectable.

We'll need a prisma/client file.

Since we need to produce a working NestJS project with Prisma. The tests need to use an in-memory test DB? Usually we use sqlite for testing. But we can use an actual Postgres connection. Not required to run; we just produce code.

Thus we need:

- prisma/schema.prisma with DocumentAnchor model, maybe also anchorState enum.

- src/main.ts (bootstrap Nest app). Use NestFactory.

- src/app.module.ts imports AnchorModule, PrismaModule, ScheduleModule.

- src/prisma/prisma.service.ts (provides PrismaClient).

- src/anchor/anchor.module.ts (provides controller, service, repository, confirmation worker). Use naming conventions: "anchor".

- src/anchor/anchor.controller.ts

- src/anchor/anchor.service.ts

- src/anchor/anchor.repository.ts

- src/anchor/chain-client.interface.ts (interface for chain client).

- src/anchor/fake-chain-client.ts (implementation for tests). Use a provider token, e.g., "CHAIN_CLIENT".

- src/anchor/anchor-confirmation.service.ts (worker for confirmation, also includes recovery sweep maybe).

- test/anchor.spec.ts (Vitest tests for the acceptance cases).

Also define DTOs: AnchorDocumentDto (documentId, version, content). VerifyDto (documentId, version, content). Responses: AnchorResponse (txId, state, maybe block) and VerifyResponse (proof or mismatch).

Define error envelope class and utility.

Now about the canonicalization function: We need to define canonical JSON: stable key ordering, minimal representation, numbers as decimal without extra zeros, whitespace removed, ensure UTF-8 encoding. Implementation: JSON.stringify with a replacer that sorts object keys.

Implementation details: function canonicalize(value): string { return JSON.stringify(sortKeys(value)); } where sortKeys recursively sorts object keys.

Edge Cases: The JSON may contain nested objects/arrays. For numbers, JSON.stringify will output numbers as they are; for canonical representation maybe we want to ensure numbers are represented in the same way (e.g., toFixed?). We'll just use JSON.stringify and ensure keys are sorted.

Define hashing: use crypto.createHash('sha256') on canonical bytes (utf-8). Output hex.

Add comment describing canonicalization: "Canonical JSON: keys sorted lexicographically at each level, whitespace removed, numbers represented without trailing zeros, UTF-8 encoding." That satisfies description.

Now implement anchorDocument:

- Compute canonicalHash = hashCanonical(content).

- Call chainClient.prepare({documentId, version, hash: canonicalHash})? The interface expects some tx; we need to define what tx is. For simplicity, we can define that tx is any object with fields: documentId, version, hash. The prepare returns txId and signedTx (string). We can pass the object to prepare.

- Create anchor in DB: repository.createAnchorIntent({documentId, version, hash: canonicalHash, txId, signedTx, state: 'prepared'}). Use a transaction (prisma.$transaction?) to ensure commit.

- Then call broadcast(signedTx). Use try-catch. If success: repository.updateState(txId, 'broadcast_sent'). If error (timeout): repository.updateState(txId, 'broadcast_unknown'). Not catching other errors.

- Return response containing txId and state.

Implementation specifics: repository methods: createIntent(data), updateStateByTxId(txId, newState), findByDocAndVersion(documentId, version), findByTxId(txId), updateReceipt(txId, blockNumber, status?). Maybe updateConfirmed.

Now confirmation service:

- find anchors with state in ['broadcast_sent', 'broadcast_unknown']? Actually unknown ones may be resolved as broadcast_sent after we attempt re-broadcast? We'll treat both.

- For each anchor, call chainClient.getReceipt(txId). If receipt exists:

  - If receipt.success is true: repository.updateStateAndBlock(txId, 'confirmed', receipt.blockNumber). If receipt indicates failure: repository.updateState(txId, 'failed').

- If receipt not found:

  - If anchor.state === 'broadcast_unknown': attempt re-broadcast: try chainClient.broadcast(anchor.signedTx). If succeeds, set state to 'broadcast_sent' maybe. If error again, remain unknown.

  - If anchor.state === 'broadcast_sent': maybe we just keep as is, waiting for receipt.

Implement getReceipt: The fake client can have a method returning maybe {blockNumber, success: boolean} or null.

Now recovery sweep: It can be the same as the confirmation service, but before doing anything else, it checks getReceipt. That's already covered.

Thus we have a combined worker: schedule to run every few seconds that processes all pending anchors.

Now about test cases:

Test 1: Intent persisted before broadcast; ensure that after broadcast, anchor row exists with txId persisted even if broadcast timed out. Steps:

- Use fake chain client. Set it to simulate broadcast timeout but transaction is successfully prepared (i.e., after broadcast call, we record receipt after some delay). For test, we can have broadcast throw a TimeoutError after adding the transaction to a pending list. Then anchorDocument catches error, updates state to broadcast_unknown.

- Then we run confirmation worker (or manually call service processPending). It will query getReceipt, which will return receipt (we can simulate by making fake client have receipt ready after broadcast). Then it will update state to confirmed.

- Verify that only one anchor row exists, with txId persisted.

- Also test that re-broadcast doesn't happen.

Test 2: Broadcast timed out and did not land: Fake client will not have receipt. After anchorDocument, state broadcast_unknown. Then run worker. getReceipt returns null, so we re-broadcast (call broadcast again). The second broadcast can succeed and then receipt appears. After processing again, we get receipt and confirm. Verify only one anchor row.

Test 3: Crash scenario: Simulate a crash between broadcast and later state update? Our design persists intent before broadcast. In case of crash after broadcast but before updating state, the anchor row is in prepared state? Actually we update state after broadcast, so after crash the row would be in prepared state, and the broadcast may have succeeded. The recovery sweep should treat prepared state as unknown? We need to handle that. For simplicity we can treat any anchor not in CONFIRMED/FAILED as pending. So after crash, row state may be prepared, but the transaction may have been broadcast. In recovery, we need to query getReceipt for such rows. If receipt found, confirm; otherwise re-broadcast.

Thus the worker should process any anchor where state is NOT CONFIRMED/FAILED, i.e., prepared, broadcast_sent, broadcast_unknown.

Thus we can handle crash.

Test 4: Attempt to anchor same (document, version) twice: should be rejected with unique constraint. We'll attempt to call anchorDocument again for same docId/version, expecting a conflict error.

Test 5: Verify content: call verify with correct content returns proof (txId, block). Call with mismatched content returns error envelope with code mismatch.

Implement verify:

- Compute hash.

- Fetch anchor row by docId/version.

- If not found, return error: resource_not_found? Or custom code.

- Compare stored hash with computed hash; if differ, return error envelope code "hash_mismatch". Provide details: expectedHash, actualHash.

- If match, ensure anchor state is confirmed; get txId and blockNumber; return proof.

Now define error envelope shape.

We can implement a helper function createErrorResponse(code, message, details) that returns object {error: {code, message, details}}. Then in controller we can throw an HttpException with that object and appropriate status code.

Define custom HttpException subclass: ApiException extends HttpException that expects code, message, details, status.

Now the code layout.

First file: prisma/schema.prisma:

We need model Anchor (or DocumentAnchor). Use snake_case for table name with @@map.

Define enum AnchorState with snake_case values.

Write model:

model Anchor {
  id            BigInt   @id @default(autoincrement())
  document_id   String
  version       Int
  hash          String
  tx_id         String
  signed_tx     String
  state         AnchorState
  block_number  Int?   // optional
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt

  @@unique([document_id, version])
  @@map("anchors")
}

enum AnchorState {
  prepared
  broadcast_sent
  broadcast_unknown
  confirmed
  failed
}

Also need mapping of enum to string in DB: we can map using `@map` attribute on enum values if needed. But Prisma default uses snake case. Use as is.

Now we need a PrismaService to instantiate PrismaClient.

File src/prisma/prisma.service.ts:

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

Now create anchor repository.

File src/anchor/anchor.repository.ts:

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Anchor, AnchorState } from '@prisma/client';

interface CreateAnchorIntentDto {
  documentId: string;
  version: number;
  hash: string;
  txId: string;
  signedTx: string;
  state: AnchorState;
}

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(data: CreateAnchorIntentDto): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        document_id: data.documentId,
        version: data.version,
        hash: data.hash,
        tx_id: data.txId,
        signed_tx: data.signedTx,
        state: data.state,
      },
    });
  }

  async updateStateByTxId(txId: string, newState: AnchorState, blockNumber?: number): Promise<Anchor> {
    const data: any = { state: newState };
    if (blockNumber !== undefined) {
      data.block_number = blockNumber;
    }
    return this.prisma.anchor.updateMany({
      where: { tx_id: txId },
      data,
    }).then(() => this.prisma.anchor.findUnique({ where: { tx_id: txId } }));
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: {
        // need composite unique: Prisma only supports findUnique on unique fields; we have a unique constraint on (document_id, version)
        // So we use findFirst with where clause.
        // but we can define a compound unique identifier using where: { document_id_version: { document_id: documentId, version } } if defined in Prisma. Not needed.
        // We'll use findFirst.
        // Note: we can use findUnique with composite unique: see Prisma docs: findUnique({ where: { document_id_version: { document_id: documentId, version } } })
      },
    });
  }

  // Actually need to adjust.

}

Wait we need to use composite unique for findUnique; we can add @@unique([document_id, version]) with a name; then Prisma generates a "document_id_version" field for where. The default name is the concatenation of fields: maybe "document_id_version". Actually Prisma generates a synthetic unique constraint name; you can refer to it via fields. According to docs, you can do:

prisma.anchor.findUnique({
  where: {
    document_id_version: {
      document_id: documentId,
      version: version,
    },
  },
});

We need to name the constraint: `@@unique([document_id, version], name: "document_version_unique")`. Then we can use:

where: { document_version_unique: { document_id: docId, version: version } }

Ok.

In schema we can define:

@@unique([document_id, version], name: "document_version_unique")

Thus we can use that.

Now in repository:

async findByDocumentAndVersion(documentId: string, version: number): Promise<Anchor | null> {
  return this.prisma.anchor.findUnique({
    where: {
      document_version_unique: {
        document_id: documentId,
        version,
      },
    },
  });
}

Similarly findByTxId.

Now implement repository functions for updating state for pending.

Now anchor.service.ts:

Implement canonicalization and hashing, anchorDocument, verify.

Define canonicalization function:

function canonicalize(value: any): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  } else {
    return JSON.stringify(value);
  }
}

Alternatively just sort keys with replacer.

Will define as described.

Define hash: crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex').

Now anchorDocument method:

async anchorDocument(documentId: string, version: number, content: any): Promise<{ txId: string; state: AnchorState }> {
  const hash = computeHash(content);
  // ensure uniqueness
  const existing = await this.anchorRepository.findByDocumentAndVersion(documentId, version);
  if (existing) {
    throw new ApiException('unique_constraint_violation', `Anchor already exists for document ${documentId} version ${version}`, {}, 409);
  }
  // Prepare transaction
  const { txId, signedTx } = await this.chainClient.prepare({ documentId, version, hash });
  // Persist intent before broadcast
  await this.anchorRepository.createIntent({
    documentId,
    version,
    hash,
    txId,
    signedTx,
    state: AnchorState.prepared,
  });
  // Broadcast
  try {
    await this.chainClient.broadcast(signedTx);
    // Update state to broadcast_sent
    await this.anchorRepository.updateStateByTxId(txId, AnchorState.broadcast_sent);
    return { txId, state: AnchorState.broadcast_sent };
  } catch (error) {
    // Assume timeout or unknown outcome
    await this.anchorRepository.updateStateByTxId(txId, AnchorState.broadcast_unknown);
    return { txId, state: AnchorState.broadcast_unknown };
  }
}

But we need to inject chainClient interface.

Define IChainClient interface:

interface IChainClient {
  prepare(tx: any): Promise<{ txId: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<{ blockNumber: number; success: boolean } | null>;
}

Now chain client injection token: 'CHAIN_CLIENT'.

We'll have a provider that uses FakeChainClient in tests; for production maybe real client.

Now verify method:

async verify(documentId:string, version:number, content:any): Promise<{ txId:string; blockNumber:number }> {
  const hash = computeHash(content);
  const anchor = await this.anchorRepository.findByDocumentAndVersion(documentId, version);
  if (!anchor) {
    throw new ApiException('resource_not_found', 'Anchor not found', {}, 404);
  }
  if (anchor.hash !== hash) {
    throw new ApiException('hash_mismatch', 'Content hash does not match anchored hash', { expectedHash: anchor.hash, actualHash: hash }, 400);
  }
  if (anchor.state !== AnchorState.confirmed) {
    // maybe not confirmed yet
    throw new ApiException('anchor_not_confirmed', 'Anchor not yet confirmed', { state: anchor.state }, 400);
  }
  return { txId: anchor.tx_id, blockNumber: anchor.block_number! };
}

Now the controller: anchor.controller.ts

Define endpoints:

POST /anchor

- Body: { documentId, version, content }.

Return { txId, state }.

GET /anchor/verify?documentId=...&version=... with body content? Since content is large JSON, better use POST /anchor/verify.

Define DTOs.

Now the confirmation worker:

File src/anchor/anchor-confirmation.service.ts

@Injectable()
export class AnchorConfirmationService {
  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: IChainClient,
  ) {}

  // Called periodically (e.g., every 5 seconds) via Cron
  @Cron('*/5 * * * * *')
  async processPendingAnchors() {
    // Find anchors not confirmed or failed
    const pending = await this.anchorRepository.findPending(); // need to implement in repo

    for (const anchor of pending) {
      const receipt = await this.chainClient.getReceipt(anchor.tx_id);
      if (receipt) {
        if (receipt.success) {
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.confirmed, receipt.blockNumber);
        } else {
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.failed);
        }
        continue;
      }

      // No receipt found, need to re-broadcast if state is broadcast_unknown or prepared
      if (anchor.state === AnchorState.broadcast_unknown || anchor.state === AnchorState.prepared) {
        try {
          await this.chainClient.broadcast(anchor.signed_tx);
          // Update state to broadcast_sent
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.broadcast_sent);
        } catch (error) {
          // Keep as unknown
        }
      }
    }
  }
}

We need repository methods findPending (select states prepared, broadcast_sent, broadcast_unknown). Also find by txId.

Define anchor.repository.ts methods accordingly.

Now module:

src/anchor/anchor.module.ts

@Module({
  imports: [PrismaModule],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorConfirmationService,
    { provide: 'CHAIN_CLIENT', useClass: FakeChainClient }, // maybe environment specific
  ],
  exports: [],
})
export class AnchorModule {}

But FakeChainClient is for tests; in production we could use real implementation.

We'll create src/anchor/fake-chain-client.ts that implements IChainClient; store in-memory map: txId -> { signedTx, receipt?, broadcasted: boolean }. The prepare returns txId = generateId (e.g., uuidv4) and signedTx = JSON.stringify(tx). It registers transaction in a map with state pending. broadcast(signedTx) will look up the tx by signedTx (maybe map from txId). We'll have a behavior mode: we can set flags to simulate timeout and receipt presence.

Simplify: FakeChainClient's constructor receives config options for test to specify behavior. In test we can create a custom provider with a configured fake. So we should not hardcode FakeChainClient as default; use injection token but test module can override provider.

Thus anchor.module.ts can provide a placeholder; but for test we can import module and override provider.

Simplify: Provide default FakeChainClient but allow override.

Now test file.

In test/anchor.spec.ts:

Set up Nest testing module with AnchorModule, PrismaModule, and override CHAIN_CLIENT with new FakeChainClient.

Also need to configure Prisma to use a test database. Use in-memory SQLite. In prisma schema we can define datasource provider "sqlite" for dev? But our schema currently for PostgreSQL. For test we can set env var. Not required.

Assume the test environment uses a SQLite file.

In tests we will:

- Create Nest app via Test.createTestingModule.

- Reset DB before each test: prisma.$executeRaw`TRUNCATE TABLE "anchors"` or delete many.

- Write test cases.

Test cases:

1. "should persist intent before broadcast and recover after timeout with receipt present".

- Setup fakeChainClient where broadcast throws TimeoutError but registers receipt after a small delay (simulate immediate receipt). We'll have a method in fakeChainClient to set receipt manually after prepare. Actually we can have broadcast that throws TimeoutError but also sets receipt in internal map after some time (or immediate). For test simplicity: broadcast throws error, but after that we manually set receipt for that txId (simulate that transaction landed). Then call anchorDocument.

- After anchorDocument resolves (with unknown state), call AnchorConfirmationService.processPendingAnchors (direct call). It should query getReceipt, find receipt, and set anchor to confirmed. Verify anchor state is confirmed, and only one row.

- Verify that second call to anchorDocument for same doc/version fails with unique constraint.

2. "should re-broadcast when broadcast timeout and receipt not found".

- Setup fakeChainClient where broadcast throws error and no receipt. After anchorDocument, call processPendingAnchors; it will attempt re-broadcast. In fake, the second broadcast will succeed (no error). Then we manually set receipt (maybe after second broadcast). Then run processPendingAnchors again; it will find receipt and confirm. Verify only one anchor row.

3. "should verify correct content returns proof".

- Use anchorDocument to anchor a doc with content. Ensure it's confirmed. Then call verify with same content; expect txId and blockNumber.

4. "should verify mismatched content returns hash_mismatch error".

- Call verify with different content; expect error envelope.

Additionally test the recovery of crash scenario: simulate process death by not calling broadcast after persist, but in code broadcast is called inside anchorDocument; to simulate crash we could simulate that after broadcast returns (or after broadcast throws?), the service crashes before updating state. But in our code we update state after broadcast; if broadcast succeeded, we then update state to broadcast_sent. Crash would happen after broadcast succeeded but before the state update, leading to missing state change. However we cannot simulate crash in code, but we can simulate by calling anchorDocument, then manually reverting the state to prepared after broadcast? Or we can simulate by manually creating an anchor with prepared state but broadcast succeeded (receipt present). Then call processPendingAnchors, and it should confirm anchor. This tests recovery from crash.

Thus we can test this as part of recovery.

We'll need to import PrismaService and AnchorRepository in test to query DB.

Now create test utilities.

Now implement the PrismaService injection token; need to create PrismaModule.

Create src/prisma/prisma.module.ts:

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

Now we also need to install @nestjs/schedule for Cron; but we can just not use Cron and expose a method. For tests, we can call processPendingAnchors manually.

We can still import ScheduleModule.forRoot() in app.module.ts but not needed for tests.

Now app.module.ts: import AnchorModule, PrismaModule, ScheduleModule.

Now main.ts: bootstrap Nest app.

Now DTO definitions.

Define src/anchor/dto/anchor-document.dto.ts

import { IsString, IsInt, IsNotEmpty } from 'class-validator';

export class AnchorDocumentDto {
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @IsInt()
  version: number;

  @IsNotEmpty()
  content: any;
}

Similarly src/anchor/dto/verify.dto.ts

Now we need the error exception class.

src/common/api-exception.ts

import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(code: string, message: string, details: Record<string, any> = {}, status: number = HttpStatus.BAD_REQUEST) {
    super(
      { error: { code, message, details } },
      status,
    );
  }
}

Now we need to import class-validator pipes: Use ValidationPipe globally.

In main.ts:

app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

Now we need to ensure that the repository's findByDocumentAndVersion uses composite unique.

Define in prisma schema:

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Anchor {
  id            BigInt   @id @default(autoincrement())
  document_id   String
  version       Int
  hash          String
  tx_id         String
  signed_tx     String
  state         AnchorState
  block_number  Int?
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt

  @@unique([document_id, version], name: "document_version_unique")
  @@map("anchors")
}

enum AnchorState {
  prepared
  broadcast_sent
  broadcast_unknown
  confirmed
  failed
}

Now repository methods.

Implement findPending:

async findPending(): Promise<Anchor[]> {
  return this.prisma.anchor.findMany({
    where: {
      state: {
        in: [
          AnchorState.prepared,
          AnchorState.broadcast_sent,
          AnchorState.broadcast_unknown,
        ],
      },
    },
  });
}

Update methods.

Implement findByTxId:

async findByTxId(txId: string): Promise<Anchor | null> {
  return this.prisma.anchor.findUnique({
    where: { tx_id: txId },
  });
}

But we need to ensure that tx_id is unique (we can enforce via unique constraint in DB). But not required.

Now anchor.service code.

Add dependency injection for repository and chain client.

Define computeHash:

private computeHash(content: any): string {
  const canonical = canonicalize(content);
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return hash;
}

Implement canonicalize function with comment describing canonicalization.

Now we need to import crypto.

Now the anchor.controller:

@Post('anchor')
async anchor(@Body() dto: AnchorDocumentDto) {
  const result = await this.anchorService.anchorDocument(dto.documentId, dto.version, dto.content);
  return result;
}

@Post('verify')
async verify(@Body() dto: VerifyDto) {
  const result = await this.anchorService.verify(dto.documentId, dto.version, dto.content);
  return result;
}

Define VerifyDto similar to AnchorDocumentDto.

Now the confirmation worker.

Need to import Cron from '@nestjs/schedule'.

Add to module imports: ScheduleModule.forRoot().

Now we need to provide the worker as provider. It will run Cron automatically.

But for tests we need to call its method.

We can expose method processPendingAnchors as public.

Now tests.

In test/anchor.spec.ts:

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AnchorModule } from '../src/anchor/anchor.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnchorConfirmationService } from '../src/anchor/anchor-confirmation.service';
import { AnchorService } from '../src/anchor/anchor.service';
import { FakeChainClient } from '../src/anchor/fake-chain-client';
import { IChainClient } from '../src/anchor/chain-client.interface';
import { AnchorState } from '@prisma/client';
import { ApiException } from '../src/common/api-exception';

describe('Anchor Flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let anchorService: AnchorService;
  let confirmationService: AnchorConfirmationService;
  let chainClient: FakeChainClient;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AnchorModule],
    })
      .overrideProvider('CHAIN_CLIENT')
      .useClass(FakeChainClient)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    anchorService = moduleRef.get(AnchorService);
    confirmationService = moduleRef.get(AnchorConfirmationService);
    chainClient = moduleRef.get(FakeChainClient);
  });

  beforeEach(async () => {
    // clean DB
    await prisma.anchor.deleteMany();
    // reset fake client state
    chainClient.reset();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('persists intent before broadcast and recovers when broadcast timed out but transaction landed', async () => {
    // Configure fake to simulate broadcast timeout but receipt present
    const content = { a: 1, b: 'test' };
    const documentId = 'doc1';
    const version = 1;

    // Prepare will be called automatically inside anchorDocument
    // We'll set fake client to have receipt after broadcast
    // The fake client will store receipt when broadcast is called; but we want broadcast to throw timeout but still mark as sent.

    // In FakeChainClient, broadcast will add to sent map and optionally throw.
    // We'll set it to throw after marking receipt.

    chainClient.setNextBroadcastShouldTimeout(true);
    // anchor
    const result = await anchorService.anchorDocument(documentId, version, content);
    expect(result.state).toBe(AnchorState.broadcast_unknown);
    // Ensure anchor exists
    const anchor = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(anchor).not.toBeNull();
    expect(anchor?.tx_id).toBe(result.txId);

    // Simulate that transaction landed (set receipt)
    chainClient.setReceipt(anchor!.tx_id, { blockNumber: 100, success: true });

    // Run confirmation worker
    await confirmationService.processPendingAnchors();

    // Verify anchor state is confirmed
    const updated = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(updated?.state).toBe(AnchorState.confirmed);
    expect(updated?.block_number).toBe(100);
  });

  it('re-broadcasts when broadcast timed out and transaction did not land', async () => {
    const content = { foo: 'bar' };
    const documentId = 'doc2';
    const version = 1;
    // Simulate broadcast timeout and no receipt initially
    chainClient.setNextBroadcastShouldTimeout(true);
    const result = await anchorService.anchorDocument(documentId, version, content);
    expect(result.state).toBe(AnchorState.broadcast_unknown);
    const anchor = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(anchor).not.toBeNull();

    // Ensure no receipt
    const receiptBefore = await chainClient.getReceipt(anchor!.tx_id);
    expect(receiptBefore).toBeNull();

    // Now configure fake to allow broadcast without timeout on re-broadcast
    chainClient.setNextBroadcastShouldTimeout(false);
    // Simulate that after re-broadcast, a receipt appears
    chainClient.setReceiptOnNextBroadcast(anchor!.tx_id, { blockNumber: 200, success: true });

    // Process pending (should attempt re-broadcast)
    await confirmationService.processPendingAnchors();

    // After re-broadcast, receipt should be present
    const receiptAfter = await chainClient.getReceipt(anchor!.tx_id);
    expect(receiptAfter).not.toBeNull();

    // Process pending again to confirm
    await confirmationService.processPendingAnchors();

    const updated = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(updated?.state).toBe(AnchorState.confirmed);
    expect(updated?.block_number).toBe(200);
  });

  it('rejects duplicate anchor for same document and version', async () => {
    const content = { a: 1 };
    const documentId = 'doc3';
    const version = 1;
    // First anchor
    await anchorService.anchorDocument(documentId, version, content);
    // Second attempt should throw unique constraint error
    await expect(anchorService.anchorDocument(documentId, version, content)).rejects.toThrow(ApiException);
  });

  it('verify returns proof for matching content', async () => {
    const content = { x: 42 };
    const documentId = 'doc4';
    const version = 1;
    // anchor and confirm
    chainClient.setNextBroadcastShouldTimeout(false);
    const result = await anchorService.anchorDocument(documentId, version, content);
    // Simulate receipt
    const txId = result.txId;
    chainClient.setReceipt(txId, { blockNumber: 300, success: true });
    // Process pending to confirm
    await confirmationService.processPendingAnchors();

    // Verify
    const proof = await anchorService.verify(documentId, version, content);
    expect(proof.txId).toBe(txId);
    expect(proof.blockNumber).toBe(300);
  });

  it('verify returns hash_mismatch error for non-matching content', async () => {
    const content = { key: 'value' };
    const documentId = 'doc5';
    const version = 1;
    chainClient.setNextBroadcastShouldTimeout(false);
    await anchorService.anchorDocument(documentId, version, content);
    // Simulate receipt and confirm
    const anchor = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    chainClient.setReceipt(anchor!.tx_id, { blockNumber: 400, success: true });
    await confirmationService.processPendingAnchors();

    const wrongContent = { key: 'different' };
    await expect(anchorService.verify(documentId, version, wrongContent)).rejects.toMatchObject({
      response: {
        error: {
          code: 'hash_mismatch',
        },
      },
    });
  });
});

Now we need to implement FakeChainClient with the needed methods: setNextBroadcastShouldTimeout, setReceipt, setReceiptOnNextBroadcast, reset, etc.

Implement FakeChainClient.

File src/anchor/fake-chain-client.ts

import { IChainClient } from './chain-client.interface';
import { v4 as uuidv4 } from 'uuid';

interface TxRecord {
  txId: string;
  signedTx: string;
  receipt?: { blockNumber: number; success: boolean };
  broadcasted: boolean;
}

export class FakeChainClient implements IChainClient {
  private txMap: Map<string, TxRecord> = new Map();
  private nextBroadcastShouldTimeout = false;
  private receiptOnNextBroadcast: { txId: string; receipt: { blockNumber: number; success: boolean } } | null = null;

  reset() {
    this.txMap.clear();
    this.nextBroadcastShouldTimeout = false;
    this.receiptOnNextBroadcast = null;
  }

  setNextBroadcastShouldTimeout(flag: boolean) {
    this.nextBroadcastShouldTimeout = flag;
  }

  // Set receipt directly for a given txId (e.g., to simulate transaction landed)
  setReceipt(txId: string, receipt: { blockNumber: number; success: boolean }) {
    const record = this.txMap.get(txId);
    if (record) {
      record.receipt = receipt;
    } else {
      // create placeholder
      this.txMap.set(txId, { txId, signedTx: '', receipt, broadcasted: false });
    }
  }

  // Schedule receipt to be added when broadcast occurs next time for a given txId
  setReceiptOnNextBroadcast(txId: string, receipt: { blockNumber: number; success: boolean }) {
    this.receiptOnNextBroadcast = { txId, receipt };
  }

  async prepare(tx: any): Promise<{ txId: string; signedTx: string }> {
    const txId = uuidv4();
    const signedTx = JSON.stringify(tx);
    this.txMap.set(txId, { txId, signedTx, broadcasted: false });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    // Find txId by signedTx
    const record = Array.from(this.txMap.values()).find((r) => r.signedTx === signedTx);
    if (!record) {
      throw new Error('Transaction not found');
    }

    // Mark as broadcasted
    record.broadcasted = true;

    // If we have a pending receipt to set on this broadcast
    if (this.receiptOnNextBroadcast && this.receiptOnNextBroadcast.txId === record.txId) {
      record.receipt = this.receiptOnNextBroadcast.receipt;
      this.receiptOnNextBroadcast = null;
    }

    if (this.nextBroadcastShouldTimeout) {
      // Simulate timeout: do not throw receipt, but we have marked broadcasted.
      // Reset flag after use
      this.nextBroadcastShouldTimeout = false;
      throw new Error('Broadcast timeout');
    }

    // Normal broadcast: nothing else needed
    return;
  }

  async getReceipt(txId: string): Promise<{ blockNumber: number; success: boolean } | null> {
    const record = this.txMap.get(txId);
    if (record && record.receipt) {
      return record.receipt;
    }
    return null;
  }
}

Now we need chain-client.interface file.

File src/anchor/chain-client.interface.ts

export interface IChainClient {
  prepare(tx: any): Promise<{ txId: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<{ blockNumber: number; success: boolean } | null>;
}

Now anchor.service.ts code:

File src/anchor/anchor.service.ts

import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { IChainClient } from './chain-client.interface';
import { AnchorState } from '@prisma/client';
import { ApiException } from '../common/api-exception';
import { createHash } from 'crypto';

@Injectable()
export class AnchorService {
  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: IChainClient,
  ) {}

  /**
   * Canonical JSON serialization:
   * - Objects: keys sorted lexicographically at each level.
   * - Arrays: order preserved.
   * - Numbers: represented as minimal decimal (no trailing zeros).
   * - No whitespace, UTF-8 encoding.
   *
   * The resulting string is hashed with SHA-256.
   */
  private canonicalize(value: any): string {
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.canonicalize(v)).join(',') + ']';
    } else if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return (
        '{' +
        keys
          .map((k) => JSON.stringify(k) + ':' + this.canonicalize(value[k]))
          .join(',') +
        '}'
      );
    } else {
      // Primitive (string, number, boolean, null)
      return JSON.stringify(value);
    }
  }

  private computeHash(content: any): string {
    const canonical = this.canonicalize(content);
    const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
    return hash;
  }

  async anchorDocument(documentId: string, version: number, content: any): Promise<{ txId: string; state: AnchorState }> {
    const hash = this.computeHash(content);

    const existing = await this.anchorRepository.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new ApiException('unique_constraint_violation', `Anchor already exists for document ${documentId} version ${version}`, {}, 409);
    }

    // Prepare transaction
    const { txId, signedTx } = await this.chainClient.prepare({ documentId, version, hash });

    // Persist intent before broadcast
    await this.anchorRepository.createIntent({
      documentId,
      version,
      hash,
      txId,
      signedTx,
      state: AnchorState.prepared,
    });

    // Broadcast transaction
    try {
      await this.chainClient.broadcast(signedTx);
      // Update state to broadcast_sent (sent but receipt unknown)
      await this.anchorRepository.updateStateByTxId(txId, AnchorState.broadcast_sent);
      return { txId, state: AnchorState.broadcast_sent };
    } catch (err) {
      // Treat any error as unknown outcome (e.g., timeout)
      await this.anchorRepository.updateStateByTxId(txId, AnchorState.broadcast_unknown);
      return { txId, state: AnchorState.broadcast_unknown };
    }
  }

  async verify(documentId: string, version: number, content: any): Promise<{ txId: string; blockNumber: number }> {
    const hash = this.computeHash(content);
    const anchor = await this.anchorRepository.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new ApiException('resource_not_found', 'Anchor not found', { documentId, version }, 404);
    }
    if (anchor.hash !== hash) {
      throw new ApiException('hash_mismatch', 'Content hash does not match anchored hash', { expectedHash: anchor.hash, actualHash: hash }, 400);
    }
    if (anchor.state !== AnchorState.confirmed) {
      throw new ApiException('anchor_not_confirmed', 'Anchor not yet confirmed', { currentState: anchor.state }, 400);
    }
    if (anchor.block_number === null) {
      throw new ApiException('missing_block_number', 'Confirmed anchor missing block number', {}, 500);
    }
    return { txId: anchor.tx_id, blockNumber: anchor.block_number };
  }
}

Now anchor.repository.ts:

File src/anchor/anchor.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Anchor, AnchorState } from '@prisma/client';

interface CreateAnchorIntentDto {
  documentId: string;
  version: number;
  hash: string;
  txId: string;
  signedTx: string;
  state: AnchorState;
}

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(data: CreateAnchorIntentDto): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        document_id: data.documentId,
        version: data.version,
        hash: data.hash,
        tx_id: data.txId,
        signed_tx: data.signedTx,
        state: data.state,
      },
    });
  }

  async updateStateByTxId(txId: string, newState: AnchorState, blockNumber?: number): Promise<void> {
    const data: any = { state: newState };
    if (blockNumber !== undefined) {
      data.block_number = blockNumber;
    }
    await this.prisma.anchor.updateMany({
      where: { tx_id: txId },
      data,
    });
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { tx_id: txId },
    });
  }

  async findPending(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: {
        state: {
          in: [AnchorState.prepared, AnchorState.broadcast_sent, AnchorState.broadcast_unknown],
        },
      },
    });
  }
}

Now anchor-confirmation.service.ts:

File src/anchor/anchor-confirmation.service.ts

import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { IChainClient } from './chain-client.interface';
import { AnchorState } from '@prisma/client';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class AnchorConfirmationService {
  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: IChainClient,
  ) {}

  /**
   * Process all pending anchors:
   * - Query receipt; if found, mark confirmed/failed.
   * - If not found and state indicates unknown outcome, re-broadcast.
   */
  async processPendingAnchors(): Promise<void> {
    const pending = await this.anchorRepository.findPending();
    for (const anchor of pending) {
      const receipt = await this.chainClient.getReceipt(anchor.tx_id);
      if (receipt) {
        if (receipt.success) {
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.confirmed, receipt.blockNumber);
        } else {
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.failed);
        }
        continue;
      }

      // No receipt yet
      if (anchor.state === AnchorState.broadcast_unknown || anchor.state === AnchorState.prepared) {
        try {
          await this.chainClient.broadcast(anchor.signed_tx);
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.broadcast_sent);
        } catch (err) {
          // Keep state as unknown; will retry later
        }
      }
    }
  }

  // Cron runs every 5 seconds (example)
  @Cron('*/5 * * * * *')
  async handleCron() {
    await this.processPendingAnchors();
  }
}

Now anchor.controller.ts:

File src/anchor/anchor.controller.ts

import { Controller, Post, Body } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { AnchorDocumentDto } from './dto/anchor-document.dto';
import { VerifyDto } from './dto/verify.dto';
import { AnchorState } from '@prisma/client';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post()
  async anchor(@Body() dto: AnchorDocumentDto) {
    const result = await this.anchorService.anchorDocument(dto.documentId, dto.version, dto.content);
    return {
      txId: result.txId,
      state: result.state,
    };
  }

  @Post('verify')
  async verify(@Body() dto: VerifyDto) {
    const proof = await this.anchorService.verify(dto.documentId, dto.version, dto.content);
    return proof;
  }
}

Now DTO files:

src/anchor/dto/anchor-document.dto.ts

import { IsString, IsInt, IsNotEmpty } from 'class-validator';

export class AnchorDocumentDto {
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @IsInt()
  version: number;

  @IsNotEmpty()
  content: any;
}

src/anchor/dto/verify.dto.ts

import { IsString, IsInt, IsNotEmpty } from 'class-validator';

export class VerifyDto {
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @IsInt()
  version: number;

  @IsNotEmpty()
  content: any;
}

Now anchor.module.ts:

File src/anchor/anchor.module.ts

import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { AnchorConfirmationService } from './anchor-confirmation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IChainClient } from './chain-client.interface';
import { FakeChainClient } from './fake-chain-client';

@Module({
  imports: [PrismaModule],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorConfirmationService,
    {
      provide: 'CHAIN_CLIENT',
      useClass: FakeChainClient, // In production replace with real implementation
    },
  ],
})
export class AnchorModule {}

Now Prisma module:

File src/prisma/prisma.module.ts

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

Now app.module.ts:

File src/app.module.ts

import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AnchorModule],
})
export class AppModule {}

Now main.ts:

File src/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap();

Now common folder for ApiException we already created.

File src/common/api-exception.ts

import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(code: string, message: string, details: Record<string, any> = {}, status: number = HttpStatus.BAD_REQUEST) {
    super(
      {
        error: {
          code,
          message,
          details,
        },
      },
      status,
    );
  }
}

Now test file.

We need to import necessary modules, but the path in test file is from test folder. Use relative imports.

test/anchor.spec.ts

Will include above code.

Now ensure we import PrismaService correctly; we need to export it from PrismaModule.

In test we need to import FakeChainClient for resetting behavior.

Potential issues:

- In test we override provider with FakeChainClient. Already done.

- In test we use chainClient.setNextBroadcastShouldTimeout etc. Need to ensure FakeChainClient has these methods.

Now confirm FakeChainClient implements IChainClient with methods prepare, broadcast, getReceipt. It also has additional methods used by test.

Potential issues: In anchor.service, after calling chainClient.prepare, we persist intent. The txId from prepare is persisted.

If broadcast succeeds, we update state to broadcast_sent.

If broadcast throws, we update state to broadcast_unknown.

In test scenario where we set next broadcast to timeout, broadcast will throw error; anchorDocument returns broadcast_unknown.

Now for receipt scenario where transaction landed, we set receipt manually using chainClient.setReceipt.

Our confirmation service will call getReceipt and then update state to confirmed with block number.

Now we need to ensure that chainClient.getReceipt returns receipt only if record.receipt exists.

FakeChainClient's broadcast method, if timeout flag is true, after marking broadcasted it will throw error. It does not set receipt. But we set receipt manually after anchorDocument.

Ok.

Now we need to ensure chainClient.setReceiptOnNextBroadcast works: The broadcast method will check if receiptOnNextBroadcast exists and txId matches, then set receipt accordingly.

In test for re-broadcast, we set receiptOnNextBroadcast after we set the next broadcast should not timeout. So on second broadcast, it will set receipt.

Now we need to ensure that after re-broadcast, chainClient.broadcast will not throw.

Now anchor.confirmationService after re-broadcast updates state to broadcast_sent. The receipt is set during broadcast; then we call processPendingAnchors again. It will find receipt and confirm.

Works.

Now we also need to implement the findByDocumentAndVersion method with composite unique. In PrismaClient we have anchor model with a unique constraint name "document_version_unique". So we can refer to where: { document_version_unique: { document_id: documentId, version } }. However, in generated Prisma client, the naming of the unique fields may be `document_id_version`. But we have explicitly set name: "document_version_unique". According to Prisma docs, naming the unique constraint gives a field name with that name as the key. Yes, you can specify `@@unique([document_id, version], name: "document_version_unique")`, then the client exposes a field `document_version_unique` for findUnique.

Thus in repository findByDocumentAndVersion we use that.

Now check PrismaService: we used `extends PrismaClient`. In the import, we need to import the generated client: `import { PrismaClient } from '@prisma/client';`. Works.

Now in repository's findByTxId we can use findUnique({ where: { tx_id: txId } }). The column name is tx_id (snake case). In Prisma model we defined tx_id. The generated field will be `tx_id`? The column name is snake case, but in Prisma model we defined `tx_id`. Actually we defined the field `tx_id` directly as column name, not mapped to other name. So field name is `tx_id`. So findUnique where: { tx_id: txId } works.

Now need to import AnchorState enum from '@prisma/client' and use it as AnchorState.prepared etc. The values are 'prepared', 'broadcast_sent', etc.

Now need to ensure the state update uses the enum values correctly.

Now we need to define the test's expectation for the anchor's state after anchorDocument: It returns AnchorState.broadcast_unknown. The test expects AnchorState.broadcast_unknown. In import, need to import AnchorState from '@prisma/client'.

Now test's call to anchorService.anchorDocument returns { txId, state } where state is AnchorState.broadcast_unknown or broadcast_sent.

All good.

Now we need to ensure anchorService returns correct type.

Now test's resetting of DB: we use `await prisma.anchor.deleteMany();` but the prisma client has property `anchor`. Yes.

Now we need to make sure we import `prisma` properly.

Now compile.

Potential issues: In anchor.service we use AnchorState enum. Need to import it from '@prisma/client'.

Now anchor.service's computeHash and canonicalize function.

Now we need to add import for `AnchorState` in anchor.service.

Now confirm file paths.

Now deliver the code files as requested. We need to list each file with a level-3 heading and fenced code block.

We need to include all files we created. Possibly also need to include package.json? Not required.

Now final answer should contain:

- prisma/schema.prisma

- src/main.ts

- src/app.module.ts

- src/prisma/prisma.service.ts

- src/prisma/prisma.module.ts

- src/common/api-exception.ts

- src/anchor/anchor.module.ts

- src/anchor/anchor.controller.ts

- src/anchor/anchor.service.ts

- src/anchor/anchor.repository.ts

- src/anchor/anchor-confirmation.service.ts

- src/anchor/chain-client.interface.ts

- src/anchor/fake-chain-client.ts

- src/anchor/dto/anchor-document.dto.ts

- src/anchor/dto/verify.dto.ts

- test/anchor.spec.ts

Possibly also src/anchor/anchor.dto? Already have.

Also we need to add import for schedule module.

Now ensure all imports have correct relative paths.

Check anchor.service imports: `import { AnchorRepository } from './anchor.repository'; import { IChainClient } from './chain-client.interface'; import { AnchorState } from '@prisma/client'; import { ApiException } from '../common/api-exception'; import { createHash } from 'crypto';` Good.

anchor.repository imports: `import { PrismaService } from '../prisma/prisma.service'; import { Anchor, AnchorState } from '@prisma/client';`.

anchor.controller imports: `import { AnchorDocumentDto } from './dto/anchor-document.dto'; import { VerifyDto } from './dto/verify.dto';`.

anchor-confirmation.service imports: `import { Cron } from '@nestjs/schedule';`.

Now check that we used `ScheduleModule.forRoot()` in app.module.

Now we need to ensure that the test overrides the provider properly.

In test we import FakeChainClient using absolute path (relative). Use `import { FakeChainClient } from '../src/anchor/fake-chain-client';` but in test file located at test/anchor.spec.ts, relative path should be `../src/anchor/fake-chain-client`. That's correct.

Also need to import AnchorService, AnchorConfirmationService, PrismaService.

Now test uses chainClient.setNextBroadcastShouldTimeout etc. Ensure FakeChainClient defines these methods as public.

Now check TypeScript compile: In FakeChainClient, we used `import { v4 as uuidv4 } from 'uuid';`. But uuid is not imported in package; but we can include it. In code we used it; it's okay.

Now final code.

Now ensure that we have no stray references.

Now confirm the unique constraint name in Prisma schema.

Now ensure that anchor.repository.findByDocumentAndVersion uses the correct unique identifier.

Implementation:

await this.prisma.anchor.findUnique({
  where: {
    document_version_unique: {
      document_id: documentId,
      version,
    },
  },
});

Yes.

Now confirm anchor.repository.findByTxId uses tx_id.

Now ensure we import AnchorState in AnchorRepository for type annotation.

Now final answer.

Potential errors:

- In Prisma schema, the field names: `document_id` etc. The type for id is BigInt; we need to set `id` type. We might use `BigInt` but Prisma's type for autoincrement is `BigInt`. Use `BigInt` field: `id BigInt @id @default(autoincrement())`.

- However `autoincrement()` on BigInt is allowed; but may need `@default(autoincrement())` is fine. Some older Prisma version uses `Int`. We can use `Int`. Use `Int` for simplicity. Use `id Int @id @default(autoincrement())`. That's fine.

- The table name mapping: `@@map("anchors")`.

- `state` type: AnchorState enum.

Now the schema:

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum AnchorState {
  prepared
  broadcast_sent
  broadcast_unknown
  confirmed
  failed
}

model Anchor {
  id           Int        @id @default(autoincrement())
  document_id  String
  version      Int
  hash         String
  tx_id        String
  signed_tx    String
  state        AnchorState
  block_number Int?
  created_at   DateTime   @default(now())
  updated_at   DateTime   @updatedAt

  @@unique([document_id, version], name: "document_version_unique")
  @@map("anchors")
}

Now adjust repository accordingly. Already used Int for id.

Now check that the repository's updateStateByTxId returns void; used in anchor.service but not expecting a return.

Now check that anchor.service's anchorDocument returns state: AnchorState, not string.

Now test imports AnchorState from '@prisma/client'.

Now need to ensure that AnchorState enum values are string (by default Prisma enums become string types). So anchor.state is string like 'prepared'.

Now test code expects AnchorState.broadcast_unknown, which resolves to string 'broadcast_unknown'.

All good.

Now final answer: Provide each file.

Let's write them.
```

## reply

### prisma/schema.prisma
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum AnchorState {
  prepared
  broadcast_sent
  broadcast_unknown
  confirmed
  failed
}

model Anchor {
  id           Int        @id @default(autoincrement())
  document_id  String
  version      Int
  hash         String
  tx_id        String
  signed_tx    String
  state        AnchorState
  block_number Int?
  created_at   DateTime   @default(now())
  updated_at   DateTime   @updatedAt

  @@unique([document_id, version], name: "document_version_unique")
  @@map("anchors")
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AnchorModule } from './anchor/anchor.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AnchorModule],
})
export class AppModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/common/api-exception.ts
```ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    code: string,
    message: string,
    details: Record<string, any> = {},
    status: number = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        error: {
          code,
          message,
          details,
        },
      },
      status,
    );
  }
}
```

### src/anchor/chain-client.interface.ts
```ts
export interface IChainClient {
  prepare(tx: any): Promise<{ txId: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<{ blockNumber: number; success: boolean } | null>;
}
```

### src/anchor/fake-chain-client.ts
```ts
import { IChainClient } from './chain-client.interface';
import { v4 as uuidv4 } from 'uuid';

interface TxRecord {
  txId: string;
  signedTx: string;
  receipt?: { blockNumber: number; success: boolean };
  broadcasted: boolean;
}

/**
 * A simple in‑memory fake chain client used in tests.
 * It allows configuring timeout behaviour and manually inserting receipts.
 */
export class FakeChainClient implements IChainClient {
  private txMap: Map<string, TxRecord> = new Map();
  private nextBroadcastShouldTimeout = false;
  private receiptOnNextBroadcast: {
    txId: string;
    receipt: { blockNumber: number; success: boolean };
  } | null = null;

  reset() {
    this.txMap.clear();
    this.nextBroadcastShouldTimeout = false;
    this.receiptOnNextBroadcast = null;
  }

  setNextBroadcastShouldTimeout(flag: boolean) {
    this.nextBroadcastShouldTimeout = flag;
  }

  /** Directly associate a receipt with a transaction (simulating a landed tx). */
  setReceipt(txId: string, receipt: { blockNumber: number; success: boolean }) {
    const rec = this.txMap.get(txId);
    if (rec) {
      rec.receipt = receipt;
    } else {
      this.txMap.set(txId, { txId, signedTx: '', receipt, broadcasted: false });
    }
  }

  /** Configure a receipt to be attached when the next broadcast of `txId` occurs. */
  setReceiptOnNextBroadcast(txId: string, receipt: { blockNumber: number; success: boolean }) {
    this.receiptOnNextBroadcast = { txId, receipt };
  }

  async prepare(tx: any): Promise<{ txId: string; signedTx: string }> {
    const txId = uuidv4();
    const signedTx = JSON.stringify(tx);
    this.txMap.set(txId, { txId, signedTx, broadcasted: false });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const record = Array.from(this.txMap.values()).find((r) => r.signedTx === signedTx);
    if (!record) {
      throw new Error('Transaction not found');
    }

    // Mark as broadcasted – the transaction exists on‑chain regardless of timeout.
    record.broadcasted = true;

    // Attach a pre‑scheduled receipt if configured.
    if (this.receiptOnNextBroadcast && this.receiptOnNextBroadcast.txId === record.txId) {
      record.receipt = this.receiptOnNextBroadcast.receipt;
      this.receiptOnNextBroadcast = null;
    }

    if (this.nextBroadcastShouldTimeout) {
      // Simulate a timeout (client never receives confirmation).
      this.nextBroadcastShouldTimeout = false;
      throw new Error('Broadcast timeout');
    }

    // Normal successful broadcast – nothing else to do.
    return;
  }

  async getReceipt(txId: string): Promise<{ blockNumber: number; success: boolean } | null> {
    const record = this.txMap.get(txId);
    if (record && record.receipt) {
      return record.receipt;
    }
    return null;
  }
}
```

### src/anchor/dto/anchor-document.dto.ts
```ts
import { IsString, IsInt, IsNotEmpty } from 'class-validator';

export class AnchorDocumentDto {
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @IsInt()
  version: number;

  @IsNotEmpty()
  content: any;
}
```

### src/anchor/dto/verify.dto.ts
```ts
import { IsString, IsInt, IsNotEmpty } from 'class-validator';

export class VerifyDto {
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @IsInt()
  version: number;

  @IsNotEmpty()
  content: any;
}
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Anchor, AnchorState } from '@prisma/client';

interface CreateAnchorIntentDto {
  documentId: string;
  version: number;
  hash: string;
  txId: string;
  signedTx: string;
  state: AnchorState;
}

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(data: CreateAnchorIntentDto): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        document_id: data.documentId,
        version: data.version,
        hash: data.hash,
        tx_id: data.txId,
        signed_tx: data.signedTx,
        state: data.state,
      },
    });
  }

  async updateStateByTxId(txId: string, newState: AnchorState, blockNumber?: number): Promise<void> {
    const data: any = { state: newState };
    if (blockNumber !== undefined) {
      data.block_number = blockNumber;
    }
    await this.prisma.anchor.updateMany({
      where: { tx_id: txId },
      data,
    });
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { tx_id: txId },
    });
  }

  async findPending(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: {
        state: {
          in: [
            AnchorState.prepared,
            AnchorState.broadcast_sent,
            AnchorState.broadcast_unknown,
          ],
        },
      },
    });
  }
}
```

### src/anchor/anchor.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { IChainClient } from './chain-client.interface';
import { AnchorState } from '@prisma/client';
import { ApiException } from '../common/api-exception';
import { createHash } from 'crypto';

@Injectable()
export class AnchorService {
  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: IChainClient,
  ) {}

  /**
   * Canonical JSON serialization:
   * - Objects: keys sorted lexicographically at each level.
   * - Arrays: order preserved.
   * - Numbers: minimal decimal representation (no trailing zeros).
   * - No whitespace; UTF‑8 encoding.
   *
   * The canonical string is hashed with SHA‑256.
   */
  private canonicalize(value: any): string {
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.canonicalize(v)).join(',') + ']';
    } else if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return (
        '{' +
        keys
          .map((k) => JSON.stringify(k) + ':' + this.canonicalize(value[k]))
          .join(',') +
        '}'
      );
    } else {
      return JSON.stringify(value);
    }
  }

  private computeHash(content: any): string {
    const canonical = this.canonicalize(content);
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  async anchorDocument(
    documentId: string,
    version: number,
    content: any,
  ): Promise<{ txId: string; state: AnchorState }> {
    const hash = this.computeHash(content);

    const existing = await this.anchorRepository.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new ApiException(
        'unique_constraint_violation',
        `Anchor already exists for document ${documentId} version ${version}`,
        {},
        409,
      );
    }

    // Prepare the transaction (local deterministic step)
    const { txId, signedTx } = await this.chainClient.prepare({ documentId, version, hash });

    // Persist the intent before broadcasting
    await this.anchorRepository.createIntent({
      documentId,
      version,
      hash,
      txId,
      signedTx,
      state: AnchorState.prepared,
    });

    // Broadcast – may timeout
    try {
      await this.chainClient.broadcast(signedTx);
      await this.anchorRepository.updateStateByTxId(txId, AnchorState.broadcast_sent);
      return { txId, state: AnchorState.broadcast_sent };
    } catch (err) {
      await this.anchorRepository.updateStateByTxId(txId, AnchorState.broadcast_unknown);
      return { txId, state: AnchorState.broadcast_unknown };
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: any,
  ): Promise<{ txId: string; blockNumber: number }> {
    const hash = this.computeHash(content);
    const anchor = await this.anchorRepository.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new ApiException('resource_not_found', 'Anchor not found', { documentId, version }, 404);
    }
    if (anchor.hash !== hash) {
      throw new ApiException(
        'hash_mismatch',
        'Content hash does not match anchored hash',
        { expectedHash: anchor.hash, actualHash: hash },
        400,
      );
    }
    if (anchor.state !== AnchorState.confirmed) {
      throw new ApiException(
        'anchor_not_confirmed',
        'Anchor not yet confirmed',
        { currentState: anchor.state },
        400,
      );
    }
    if (anchor.block_number === null) {
      throw new ApiException('missing_block_number', 'Confirmed anchor missing block number', {}, 500);
    }
    return { txId: anchor.tx_id, blockNumber: anchor.block_number };
  }
}
```

### src/anchor/anchor.controller.ts
```ts
import { Controller, Post, Body } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { AnchorDocumentDto } from './dto/anchor-document.dto';
import { VerifyDto } from './dto/verify.dto';
import { AnchorState } from '@prisma/client';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post()
  async anchor(@Body() dto: AnchorDocumentDto) {
    const result = await this.anchorService.anchorDocument(dto.documentId, dto.version, dto.content);
    return {
      txId: result.txId,
      state: result.state as AnchorState,
    };
  }

  @Post('verify')
  async verify(@Body() dto: VerifyDto) {
    const proof = await this.anchorService.verify(dto.documentId, dto.version, dto.content);
    return proof;
  }
}
```

### src/anchor/anchor-confirmation.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { IChainClient } from './chain-client.interface';
import { AnchorState } from '@prisma/client';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class AnchorConfirmationService {
  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: IChainClient,
  ) {}

  /**
   * Scan all pending anchors:
   *   - If a receipt exists, transition to CONFIRMED or FAILED.
   *   - If no receipt and the broadcast outcome is unknown, re‑broadcast the same signed tx.
   */
  async processPendingAnchors(): Promise<void> {
    const pending = await this.anchorRepository.findPending();
    for (const anchor of pending) {
      const receipt = await this.chainClient.getReceipt(anchor.tx_id);
      if (receipt) {
        if (receipt.success) {
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.confirmed, receipt.blockNumber);
        } else {
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.failed);
        }
        continue;
      }

      // No receipt yet – attempt re‑broadcast if we don’t know the outcome.
      if (anchor.state === AnchorState.broadcast_unknown || anchor.state === AnchorState.prepared) {
        try {
          await this.chainClient.broadcast(anchor.signed_tx);
          await this.anchorRepository.updateStateByTxId(anchor.tx_id, AnchorState.broadcast_sent);
        } catch (err) {
          // Keep in unknown state; will retry later.
        }
      }
    }
  }

  // Run automatically every 5 seconds (example interval).
  @Cron('*/5 * * * * *')
  async handleCron() {
    await this.processPendingAnchors();
  }
}
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { AnchorConfirmationService } from './anchor-confirmation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IChainClient } from './chain-client.interface';
import { FakeChainClient } from './fake-chain-client';

@Module({
  imports: [PrismaModule],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorConfirmationService,
    {
      provide: 'CHAIN_CLIENT',
      useClass: FakeChainClient, // In production replace with real implementation
    } as { provide: string; useClass: typeof FakeChainClient },
  ],
})
export class AnchorModule {}
```

### test/anchor.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AnchorModule } from '../src/anchor/anchor.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorConfirmationService } from '../src/anchor/anchor-confirmation.service';
import { FakeChainClient } from '../src/anchor/fake-chain-client';
import { AnchorState } from '@prisma/client';
import { ApiException } from '../src/common/api-exception';

describe('Anchor Flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let anchorService: AnchorService;
  let confirmationService: AnchorConfirmationService;
  let chainClient: FakeChainClient;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AnchorModule],
    })
      .overrideProvider('CHAIN_CLIENT')
      .useClass(FakeChainClient)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    anchorService = moduleRef.get(AnchorService);
    confirmationService = moduleRef.get(AnchorConfirmationService);
    chainClient = moduleRef.get(FakeChainClient);
  });

  beforeEach(async () => {
    // Clean the DB before each test
    await prisma.anchor.deleteMany();
    chainClient.reset();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('persists intent before broadcast and recovers when broadcast timed out but transaction landed', async () => {
    const content = { a: 1, b: 'test' };
    const documentId = 'doc1';
    const version = 1;

    // Simulate a broadcast timeout (client throws) but the transaction actually lands.
    chainClient.setNextBroadcastShouldTimeout(true);

    const result = await anchorService.anchorDocument(documentId, version, content);
    expect(result.state).toBe(AnchorState.broadcast_unknown);

    const anchor = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(anchor).not.toBeNull();
    expect(anchor?.tx_id).toBe(result.txId);

    // Manually insert a receipt to simulate that the transaction succeeded on‑chain.
    chainClient.setReceipt(anchor!.tx_id, { blockNumber: 100, success: true });

    // Run the confirmation worker.
    await confirmationService.processPendingAnchors();

    const updated = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(updated?.state).toBe(AnchorState.confirmed);
    expect(updated?.block_number).toBe(100);
  });

  it('re‑broadcasts when broadcast timed out and transaction did not land', async () => {
    const content = { foo: 'bar' };
    const documentId = 'doc2';
    const version = 1;

    // First broadcast times out and no receipt is present.
    chainClient.setNextBroadcastShouldTimeout(true);
    const result = await anchorService.anchorDocument(documentId, version, content);
    expect(result.state).toBe(AnchorState.broadcast_unknown);

    const anchor = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(anchor).not.toBeNull();

    // Ensure there is still no receipt.
    const receiptBefore = await chainClient.getReceipt(anchor!.tx_id);
    expect(receiptBefore).toBeNull();

    // Configure the next broadcast to succeed and attach a receipt.
    chainClient.setNextBroadcastShouldTimeout(false);
    chainClient.setReceiptOnNextBroadcast(anchor!.tx_id, { blockNumber: 200, success: true });

    // Process pending anchors – this should trigger the re‑broadcast.
    await confirmationService.processPendingAnchors();

    // After the re‑broadcast the receipt should be available.
    const receiptAfter = await chainClient.getReceipt(anchor!.tx_id);
    expect(receiptAfter).not.toBeNull();

    // Run the worker again to confirm the anchor.
    await confirmationService.processPendingAnchors();

    const updated = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    expect(updated?.state).toBe(AnchorState.confirmed);
    expect(updated?.block_number).toBe(200);
  });

  it('rejects duplicate anchor for same document and version', async () => {
    const content = { a: 1 };
    const documentId = 'doc3';
    const version = 1;

    await anchorService.anchorDocument(documentId, version, content);
    await expect(anchorService.anchorDocument(documentId, version, content)).rejects.toThrow(ApiException);
  });

  it('verify returns proof for matching content', async () => {
    const content = { x: 42 };
    const documentId = 'doc4';
    const version = 1;

    // Normal broadcast (no timeout).
    chainClient.setNextBroadcastShouldTimeout(false);
    const result = await anchorService.anchorDocument(documentId, version, content);

    // Simulate receipt.
    chainClient.setReceipt(result.txId, { blockNumber: 300, success: true });
    await confirmationService.processPendingAnchors();

    const proof = await anchorService.verify(documentId, version, content);
    expect(proof.txId).toBe(result.txId);
    expect(proof.blockNumber).toBe(300);
  });

  it('verify returns hash_mismatch error for non‑matching content', async () => {
    const content = { key: 'value' };
    const documentId = 'doc5';
    const version = 1;

    chainClient.setNextBroadcastShouldTimeout(false);
    await anchorService.anchorDocument(documentId, version, content);

    const anchor = await prisma.anchor.findUnique({
      where: {
        document_version_unique: {
          document_id: documentId,
          version,
        },
      },
    });
    chainClient.setReceipt(anchor!.tx_id, { blockNumber: 400, success: true });
    await confirmationService.processPendingAnchors();

    const wrongContent = { key: 'different' };
    await expect(anchorService.verify(documentId, version, wrongContent)).rejects.toMatchObject({
      response: {
        error: {
          code: 'hash_mismatch',
        },
      },
    });
  });
});
```

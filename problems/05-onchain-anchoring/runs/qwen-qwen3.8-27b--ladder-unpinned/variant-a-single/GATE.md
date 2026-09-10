$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 23, reused 11, downloaded 5, added 0
Progress: resolved 229, reused 124, downloaded 24, added 0
Packages: +192
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 264, reused 157, downloaded 35, added 190
Progress: resolved 264, reused 157, downloaded 35, added 192, done

dependencies:
+ @nestjs/common 11.2.3 (12.0.1 is available)
+ @nestjs/core 11.2.3 (12.0.1 is available)
+ @nestjs/platform-express 11.2.3 (12.0.1 is available)
+ @prisma/client 6.19.3 (7.10.0 is available)
+ class-transformer 0.5.1
+ class-validator 0.14.4 (0.15.1 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 11.2.3 (12.0.1 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ prisma 6.19.3 (8.0.0-rc.13 is available)
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.7s

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v6.19.3) to ./node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client in 37ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/anchors/anchors.repository.ts(62,53): error TS2322: Type 'CreateAnchorIntent' is not assignable to type '(Without<AnchorCreateInput, AnchorUncheckedCreateInput> & AnchorUncheckedCreateInput) | (Without<...> & AnchorCreateInput)'.
  Type 'CreateAnchorIntent' is not assignable to type 'Without<AnchorUncheckedCreateInput, AnchorCreateInput> & AnchorCreateInput'.
    Type 'CreateAnchorIntent' is not assignable to type 'AnchorCreateInput'.
      Types of property 'payload' are incompatible.
        Type 'AnchorTxPayload' is not assignable to type 'JsonNull | InputJsonValue'.
          Type 'AnchorTxPayload' is not assignable to type 'InputJsonObject'.
            Index signature for type 'string' is missing in type 'AnchorTxPayload'.
src/anchors/anchors.repository.ts(163,16): error TS2352: Conversion of type 'string | number | boolean | JsonObject | JsonArray | null' to type 'AnchorTxPayload' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type 'JsonValue[]' is missing the following properties from type 'AnchorTxPayload': kind, documentId, version, contentHash


$ tsc --noEmit (attempt 1) -> 2
src/anchors/anchors.controller.ts(3,15): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'.
src/anchors/anchors.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/anchors/anchors.repository.ts(8,33): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../chain/chain-client.js'?
src/anchors/anchors.repository.ts(33,30): error TS2339: Property 'PENDING_BROADCAST' does not exist on type '{ PREPARED: "PREPARED"; BROADCAST_SENT: "BROADCAST_SENT"; OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN"; CONFIRMED: "CONFIRMED"; FAILED: "FAILED"; }'.
src/anchors/anchors.service.ts(19,3): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'.
src/anchors/anchors.service.ts(20,3): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorStatusValue'.
src/anchors/anchors.service.ts(22,3): error TS2305: Module '"./anchors.repository.js"' has no exported member 'DuplicateAnchorError'.
src/anchors/anchors.service.ts(168,35): error TS2339: Property 'createIntent' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.service.ts(181,11): error TS18046: 'error' is of type 'unknown'.
src/anchors/anchors.service.ts(182,11): error TS18046: 'error' is of type 'unknown'.
src/anchors/anchors.service.ts(193,33): error TS2339: Property 'markBroadcastSent' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.service.ts(198,28): error TS2339: Property 'markFailed' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.service.ts(207,33): error TS2339: Property 'markOutcomeUnknown' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.service.ts(218,39): error TS2551: Property 'findByDocumentVersion' does not exist on type 'AnchorsRepository'. Did you mean 'findByDocumentAndVersion'?
src/anchors/anchors.worker.ts(25,37): error TS2339: Property 'findBroadcastSent' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.worker.ts(31,28): error TS2339: Property 'markConfirmed' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.worker.ts(33,28): error TS2339: Property 'markFailed' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.worker.ts(60,47): error TS2345: Argument of type 'number' is not assignable to parameter of type 'AnchorStatus'.
src/anchors/anchors.worker.ts(66,30): error TS2339: Property 'markConfirmed' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.worker.ts(68,30): error TS2339: Property 'markFailed' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.worker.ts(76,28): error TS2339: Property 'markBroadcastSent' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.worker.ts(79,30): error TS2339: Property 'markFailed' does not exist on type 'AnchorsRepository'.
src/anchors/anchors.worker.ts(82,30): error TS2339: Property 'markOutcomeUnknown' does not exist on type 'AnchorsRepository'.


$ tsc --noEmit (attempt 2) -> 2
src/anchors/anchors.controller.ts(46,48): error TS2554: Expected 3 arguments, but got 2.
src/anchors/anchors.controller.ts(61,5): error TS2322: Type 'VerifyResult' is not assignable to type 'VerifyResponseDto'.
  Type 'VerifyResult' is not assignable to type 'VerifyProofDto'.
    Types of property 'txId' are incompatible.
      Type 'string | null' is not assignable to type 'string'.
        Type 'null' is not assignable to type 'string'.
src/anchors/anchors.controller.ts(65,26): error TS2304: Cannot find name 'DuplicateAnchorError'.
src/anchors/anchors.module.ts(9,3): error TS2305: Module '"./anchors.worker.js"' has no exported member 'AnchorWorkersService'.
src/anchors/anchors.module.ts(10,3): error TS2305: Module '"./anchors.worker.js"' has no exported member 'ConfirmationWorkerService'.
src/anchors/anchors.module.ts(11,3): error TS2305: Module '"./anchors.worker.js"' has no exported member 'RecoverySweepService'.
src/anchors/anchors.repository.ts(2,23): error TS2305: Module '"../chain/chain-client.js"' has no exported member 'AnchorReceipt'.
src/anchors/anchors.repository.ts(3,66): error TS2307: Cannot find module './anchor-status.js' or its corresponding type declarations.
src/anchors/anchors.service.ts(4,35): error TS2307: Cannot find module './anchor-status.js' or its corresponding type declarations.
src/anchors/anchors.service.ts(61,57): error TS2345: Argument of type 'string' is not assignable to parameter of type 'AnchorTxPayload'.
src/anchors/anchors.worker.ts(3,10): error TS2305: Module '"../chain/chain-client.js"' has no exported member 'AnchorReceipt'.


$ vitest run -> 1
e significant)
TypeError: canonicalHashOf is not a function
 ❯ test/canonical-hash.spec.ts:34:12
     32| 
     33|   it('preserves array order (positions are significant)', () => {
     34|     expect(canonicalHashOf([1, 2, 3])).not.toBe(canonicalHashOf([3, 2,…
       |            ^
     35|   });
     36| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/44]⎯

 FAIL  test/canonical-hash.spec.ts > canonicalization > produces a stable lowercase 64-char SHA-256 hex digest over the UTF-8 canonical bytes
TypeError: canonicalHashOf is not a function
 ❯ test/canonical-hash.spec.ts:47:19
     45| 
     46|   it('produces a stable lowercase 64-char SHA-256 hex digest over the …
     47|     const first = canonicalHashOf(SAMPLE_CONTENT);
       |                   ^
     48|     expect(first).toMatch(/^[0-9a-f]{64}$/);
     49|     expect(canonicalHashOf(SAMPLE_CONTENT)).toBe(first);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/44]⎯

 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > confirms from the receipt when the broadcast timed out but landed — no re-broadcast
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > re-broadcasts the SAME signed tx when the chain has no trace, ending with one anchor and one tx identity
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > broadcasts a stale PREPARED anchor (crashed before the broadcast call) without a second identity
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > marks FAILED when the sweep finds a failed receipt, without re-broadcasting
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > crash between broadcast and status update: the restarted app recovers from the chain — one anchor, one tx identity
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > crash after the chain already confirmed: the sweep confirms from the receipt without re-broadcasting
TypeError: ConfirmationWorkerService is not a constructor
 ❯ Module.createHarness test/harness.ts:35:24
     33|   const repo = new AnchorsRepository(prisma);
     34|   const service = new AnchorsService(content, chain, repo);
     35|   const confirmation = new ConfirmationWorkerService(repo, chain);
       |                        ^
     36|   const sweep = new RecoverySweepService(repo, chain);
     37|   return { prisma, chain, content, repo, service, confirmation, sweep …
 ❯ test/recovery.spec.ts:27:9

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/44]⎯

 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > confirms from the receipt when the broadcast timed out but landed — no re-broadcast
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > re-broadcasts the SAME signed tx when the chain has no trace, ending with one anchor and one tx identity
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > broadcasts a stale PREPARED anchor (crashed before the broadcast call) without a second identity
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > marks FAILED when the sweep finds a failed receipt, without re-broadcasting
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > crash between broadcast and status update: the restarted app recovers from the chain — one anchor, one tx identity
 FAIL  test/recovery.spec.ts > recovery sweep and confirmation worker > crash after the chain already confirmed: the sweep confirms from the receipt without re-broadcasting
TypeError: Cannot read properties of undefined (reading 'prisma')
 ❯ Module.disposeHarness test/harness.ts:41:17
     39| 
     40| export async function disposeHarness(harness: Harness): Promise<void> {
     41|   await harness.prisma.$disconnect();
       |                 ^
     42| }
     43| 
 ❯ test/recovery.spec.ts:33:11

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/44]⎯

 FAIL  test/verify.spec.ts > verify > returns the anchoring proof (txId, block) for matching content
 FAIL  test/verify.spec.ts > verify > reports a content mismatch with both hashes when the supplied content differs
 FAIL  test/verify.spec.ts > verify > reports not_anchored when the version has no anchor
 FAIL  test/verify.spec.ts > verify > reports pending with the tx identity when the anchor is not yet confirmed
 FAIL  test/verify.spec.ts > verify > prefers the mismatch report over anchor state when the hash differs
 FAIL  test/verify.spec.ts > verify > reports anchor_failed with the reason when the anchor failed on chain
TypeError: ConfirmationWorkerService is not a constructor
 ❯ Module.createHarness test/harness.ts:35:24
     33|   const repo = new AnchorsRepository(prisma);
     34|   const service = new AnchorsService(content, chain, repo);
     35|   const confirmation = new ConfirmationWorkerService(repo, chain);
       |                        ^
     36|   const sweep = new RecoverySweepService(repo, chain);
     37|   return { prisma, chain, content, repo, service, confirmation, sweep …
 ❯ test/verify.spec.ts:11:9

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/44]⎯

 FAIL  test/verify.spec.ts > verify > returns the anchoring proof (txId, block) for matching content
 FAIL  test/verify.spec.ts > verify > reports a content mismatch with both hashes when the supplied content differs
 FAIL  test/verify.spec.ts > verify > reports not_anchored when the version has no anchor
 FAIL  test/verify.spec.ts > verify > reports pending with the tx identity when the anchor is not yet confirmed
 FAIL  test/verify.spec.ts > verify > prefers the mismatch report over anchor state when the hash differs
 FAIL  test/verify.spec.ts > verify > reports anchor_failed with the reason when the anchor failed on chain
TypeError: Cannot read properties of undefined (reading 'prisma')
 ❯ Module.disposeHarness test/harness.ts:41:17
     39| 
     40| export async function disposeHarness(harness: Harness): Promise<void> {
     41|   await harness.prisma.$disconnect();
       |                 ^
     42| }
     43| 
 ❯ test/verify.spec.ts:17:11

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[14/44]⎯



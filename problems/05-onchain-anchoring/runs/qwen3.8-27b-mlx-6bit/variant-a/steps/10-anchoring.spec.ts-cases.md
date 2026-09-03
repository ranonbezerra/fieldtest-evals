# 10-anchoring.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/anchoring.spec.ts` based on the PLAN.md specification and the implementation files shown. I need to follow the exact format specified: one line per case, with the shape `- <name of the test> — <what it proves, and what would have to be broken for it to fail>`.

Let me go through the plan's test section and the implementation to identify all behavioural cases:

From PLAN.md section 5:
1. Canonicalize determinism (key order independence)
2. Canonicalize value change produces different hash
3. Anchor happy path (broadcast success)
4. Duplicate anchor rejected
5. Broadcast timeout leaves row in pending
6. Broadcast hard failure marks row failed
7. Verify match (after confirmation)
8. Verify mismatch
9. Verify not found
10. Recovery sweep resolves crashed-after-broadcast (the critical test)
11. Recovery sweep re-broadcasts unsubmitted tx
12. Confirmation worker confirms broadcast rows
13. Worker skips on null receipt for broadcast row

Now let me think about what additional cases are needed based on the implementation and the task statement:

- The task says "Exactly one anchor per (document, version), enforced at the schema level, and proven by a test that crashes the process between broadcast and the (wrong) late persist a naive design would do." — This is the crash test. The plan calls it "Recovery sweep resolves crashed-after-broadcast" but I should be more specific about what it proves.

- Concurrency: What if two concurrent calls to anchorDocument for the same (documentId, version) both pass prepare and one wins the insert? The unique constraint catches it. This is the duplicate test but from a concurrency angle.

- The canonicalize function: what about nested objects, arrays, null values, empty objects?

- Worker tick with no rows (exhaustion/empty case)

- The recovery sweep: what if getReceipt returns a failure receipt? (on-chain failure path)

- markFailed with a reason — the reason is stored correctly

- The `anchorDocument` ordering: persist MUST happen before broadcast. If we crash between persist and broadcast, the row should be in `pending` state and recoverable. This is the critical invariant.

- What about the error envelope? The controller maps errors to the right HTTP status codes. But the tests are at the service/repository level per the plan... Actually the plan says tests are in `test/anchoring.spec.ts` and they test behaviour. Let me look at what the plan says about testing level — it says "Test the behaviour, not the implementation." The tests use a fake chain client and presumably a real or mocked repository.

Let me also think about edge cases:
- Version is 0 (boundary) — should the controller reject it? The plan says "version is a positive integer" so 0 should be rejected.
- Content is empty object {} — should still hash and work.
- Content with deeply nested structures — canonicalize handles recursion.

Let me think about what "would have to be broken for it to fail" means for each:

1. **Canonicalize: key order independence** — If the sort in `sortKeys` were removed or used an unstable sort, two objects with different insertion order would produce different hashes.

2. **Canonicalize: value sensitivity** — If the hash function were a no-op or the JSON serialization were wrong, changing a value wouldn't change the hash.

3. **Canonicalize: nested structures** — If `sortKeys` didn't recurse into nested objects or arrays, deeply nested key reordering would produce different hashes.

4. **Anchor happy path** — If persist happened AFTER broadcast (the naive wrong design), or if the status wasn't set to 'broadcast' after a successful broadcast, the row state would be wrong.

5. **Duplicate anchor (unique constraint)** — If the `@@unique` constraint were missing from the schema, a second insert would succeed. If the error handling didn't catch P2002 and map to `duplicate_anchor`, the wrong error would surface.

6. **Broadcast timeout → pending** — If the timeout was not caught as `BroadcastTimeoutError` specifically (e.g., caught as generic error), the row would be marked `failed` instead of staying `pending`. If the code persisted AFTER broadcast, the row wouldn't exist at all.

7. **Broadcast hard failure → failed** — If non-timeout errors were also swallowed (like the timeout path), the row would stay `pending` instead of being marked `failed`. If the reason wasn't stored, the failureReason would be null.

8. **Verify match** — If `canonicalize` in verify used a different algorithm than in anchorDocument, the hashes would never match. If the lookup used wrong fields, it wouldn't find the anchor.

9. **Verify mismatch** — If the comparison were inverted (=== instead of !==), a mismatch would report match: true.

10. **Verify not found** — If the null check on `findByDocumentAndVersion` were missing or inverted, it would throw a TypeError instead of the structured error, or would proceed to hash-compare against undefined.

11. **Recovery: crashed after broadcast (receipt exists)** — This is THE critical test. If the persist were after broadcast (naive design), there would be no row to recover — the anchor would be silently lost. If `resolvePending` checked the receipt AFTER re-broadcasting (wrong order), it would double-broadcast. If it didn't check the receipt at all, it would always re-broadcast even when already confirmed on-chain.

12. **Recovery: unsubmitted tx (receipt null, re-broadcast)** — If `resolvePending` didn't attempt re-broadcast when receipt is null, the anchor would stay pending forever. If it marked the row failed instead of broadcast on successful re-broadcast, the state would be wrong.

13. **Recovery: on-chain failure receipt** — If a failure receipt were treated the same as success, the anchor would be marked confirmed with garbage block data. If it weren't handled at all, the row would stay pending forever.

14. **Confirmation worker: confirms broadcast row** — If `confirmBroadcast` didn't call `markConfirmed` with the receipt's block data, the anchor would never reach terminal state. If it called `markBroadcast` instead of `markConfirmed`, it would stay in broadcast forever.

15. **Confirmation worker: null receipt is no-op** — If a null receipt triggered `markFailed`, anchors would be incorrectly failed while still in flight. If it triggered re-broadcast, it would double-broadcast.

16. **Worker tick: empty (no pending, no broadcast rows)** — If the worker crashed on an empty result set, the interval would stop and all future anchors would be stuck. This is more of a "doesn't crash" test.

17. **Worker tick: individual row error doesn't stop the loop** — If one row's `resolvePending` threw an unhandled error and the for-loop didn't catch it, subsequent rows in the same tick would be skipped, potentially leaving them stuck.

18. **Concurrent duplicate (race on insert)** — Two simultaneous `anchorDocument` calls for the same (doc, version): one wins, one gets P2002. If the unique constraint were an application-level check (SELECT then INSERT) instead of a schema constraint, both could pass the check before either inserts.

19. **The crash test specifically named in the task** — "proven by a test that crashes the process between broadcast and the (wrong) late persist a naive design would do." This is essentially test 11 but framed as: simulate a crash (process dies) after broadcast but before the status update to 'broadcast'. The row is in 'pending'. On restart, the recovery sweep finds it, queries the chain, gets the receipt, and confirms. The anchor is NOT lost. What would break: if persist were after broadcast (no row exists), or if recovery didn't query the chain first.

Let me also think about:
- `canonicalize` with arrays — arrays preserve order (they're positional), so [1,2,3] ≠ [3,2,1]. If arrays were also sorted, this would break.
- The signedTx is stored so recovery can re-broadcast without re-preparing. If it weren't stored, recovery would need to call prepare again (which might not be deterministic in all cases).

Let me structure this properly now. I'll aim for clarity and make sure each failure condition is specific.

Actually, re-reading the rules: "Include the cases that are awkward: concurrency, duplicate delivery, exhaustion, boundary values, the error path that looks like the success path."

- Concurrency: the race condition on duplicate insert
- Duplicate delivery: recovery sweep running twice for the same pending row (idempotency) — if it re-broadcasts twice, does the chain handle that? In our fake, we can verify it doesn't double-broadcast when receipt already exists.
- Exhaustion: worker tick with 0 rows
- Boundary values: version = 1 (minimum valid), empty content object
- Error path that looks like success: a receipt with status 'failure' (it IS a receipt, but the tx failed) — this looks like we got a response but it's actually a failure.

Let me finalize my list. I'll keep it focused and make sure each line has a clear "what would have to break" clause.
```

## reply

- **canonicalize: key insertion order does not affect the hash** — proves recursive alphabetical sort produces a stable canonical form; fails if `sortKeys` omitted the `.sort()` call, used an unstable comparator, or skipped recursion into nested objects/arrays.
- **canonicalize: a single leaf value change produces a different hash** — proves the hash is content-sensitive and not degenerate; fails if the JSON serialization were a constant, if `createHash` were bypassed, or if only top-level keys were hashed while ignoring values.
- **canonicalize: arrays preserve positional order (not sorted)** — proves `[1,2,3]` and `[3,2,1]` hash differently; fails if `sortKeys` applied `.sort()` to arrays as it does to objects, collapsing distinct orderings into the same hash.
- **anchorDocument happy path: row persisted before broadcast, status advances to 'broadcast'** — proves the intent row exists in the DB *before* the chain call returns, and that a successful broadcast transitions it to `broadcast`; fails if the insert were moved after `await chain.broadcast` (the naive late-persist design), or if `markBroadcast` were never called.
- **anchorDocument: broadcast timeout leaves row in 'pending' and returns pending status** — proves a `BroadcastTimeoutError` is treated as an unknown outcome, not a failure; fails if the catch block treated `BroadcastTimeoutError` identically to a generic error (marking `failed`), or if the row were deleted/absent because persist hadn't happened yet.
- **anchorDocument: broadcast hard failure marks row 'failed' with reason and throws broadcast_failed** — proves a non-timeout broadcast error is terminal and recorded; fails if the error were swallowed (row stays `pending`), if `failureReason` were not written, or if the thrown error lacked the `broadcast_failed` code.
- **duplicate anchor: second insert for same (documentId, version) throws duplicate_anchor** — proves the `@@unique` constraint is the enforcement mechanism, not an application-level pre-check; fails if the unique index were removed from the schema and the service relied on a SELECT-then-INSERT race window, or if the P2002 error were not mapped to `duplicate_anchor`.
- **concurrent duplicate: two simultaneous anchorDocument calls for same (document, version), exactly one succeeds** — proves the schema-level constraint holds under race; fails if enforcement were a `findByDocumentAndVersion` guard in the service (both reads return null before either insert commits), allowing two rows.
- **verify: matching content returns match=true with proof fields (txId, blockNumber, blockHash)** — proves the recomputed hash equals the stored hash and the anchor's on-chain proof is returned; fails if `canonicalize` were called with different arguments in verify vs. anchor, if the lookup keyed on wrong columns, or if `blockNumber`/`blockHash` were not populated by a prior confirmation.
- **verify: mismatched content returns match=false with both hashes present** — proves a tampered or wrong document is detected and both hashes are exposed for audit; fails if the comparison were inverted (`!==` instead of `===`), or if `anchoredHash` were omitted from the result.
- **verify: no anchor for (documentId, version) throws resource_not_found** — proves the absence path returns a structured error, not a TypeError or 500; fails if the null check on `findByDocumentAndVersion` were missing (proceeding to hash-compare against `undefined`), or if the error code were something other than `resource_not_found`.
- **recovery sweep: pending row with existing on-chain receipt is confirmed (crash-after-broadcast recovery)** — proves that if the process dies between a successful broadcast and the `markBroadcast` call, the anchor is not lost; the sweep queries the chain first, finds the receipt, and confirms. Fails if persist were after broadcast (no row to find), if `resolvePending` re-broadcast before querying the receipt (double-submit), or if a success receipt were treated as null.
- **recovery sweep: pending row with no receipt is re-broadcast and transitions to 'broadcast'** — proves a tx that never hit the chain (crash before broadcast) is recovered by re-broadcasting the stored `signedTx`; fails if `resolvePending` marked the row `failed` on null receipt instead of retrying, or if it called `chain.prepare` again instead of using the stored `signedTx`.
- **recovery sweep: pending row with on-chain failure receipt is marked 'failed'** — proves the error path that looks like a success (a receipt exists, but `status: 'failure'`) is distinguished from confirmation; fails if the receipt's `status` field were ignored and any non-null receipt triggered `markConfirmed`.
- **recovery sweep idempotency: running tick twice for a confirmed row does not re-broadcast or corrupt state** — proves duplicate delivery of the same pending row (e.g., overlapping ticks before the status write commits) is safe; fails if `findPending` could return a row that was already transitioned to `confirmed` by a prior tick in the same batch, causing a second `broadcast` call.
- **confirmation worker: broadcast row with success receipt transitions to 'confirmed' with block data** — proves the normal post-broadcast confirmation path; fails if `confirmBroadcast` called `markBroadcast` (no-op state change) instead of `markConfirmed`, or if `blockNumber`/`blockHash` were not persisted.
- **confirmation worker: broadcast row with null receipt is a no-op (stays 'broadcast')** — proves an in-flight tx that hasn't been mined yet is not prematurely failed or re-broadcast; fails if a null receipt triggered `markFailed` (killing in-flight anchors) or triggered another `broadcast` call (double-submit).
- **worker tick: zero pending and zero broadcast rows completes without error** — proves the worker does not crash on an empty result set (exhaustion boundary); fails if the code dereferenced `pending[0]` or called `.forEach` on `undefined` when the repository returned an empty array vs. null.
- **worker tick: an exception in resolvePending for one row does not prevent processing subsequent rows** — proves per-row error isolation; fails if the `for` loop lacked a try/catch and a single row's thrown error aborted the entire tick, leaving later rows stuck until the next interval.
- **anchorDocument: content is empty object {} — still produces a valid hash and anchor** — proves the minimum boundary of structured content is handled; fails if `canonicalize` or the controller validation rejected an empty object, or if `JSON.stringify({})` produced something that collided with a null/undefined input.
- **anchorDocument: version 0 is rejected (boundary below minimum positive integer)** — proves the controller's input validation enforces `version >= 1`; fails if the check were `> 0` missing, or if the service accepted version 0 and stored it, violating the "positive integer" contract.

Not testing: real chain RPC behaviour (timeout durations, network partitioning), PDF rendering fidelity, Prisma connection pooling under load, or the NestJS HTTP transport layer (CORS, content-type negotiation) — these are out of scope for unit-level behavioural tests against the fake chain client and in-memory/transactional Postgres.

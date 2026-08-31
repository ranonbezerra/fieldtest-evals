# 10-anchor.controller.spec.ts-cases

## reasoning

```
Let me look at the controller implementation and think about what test cases to enumerate.

The controller has:
- `anchor` endpoint: `POST /anchors/:documentId/:version/anchor`, body `{ content }`
- `verify` endpoint: `POST /anchors/:documentId/:version/verify`, body `{ content }`

Validation logic:
1. `requireDocumentId`: throws BadRequestException if documentId is not a non-empty string. But wait — `@Param()` always returns a string (or undefined if the route doesn't match). Actually, in NestJS, `@Param()` for a route param is a string. If the route is `:documentId/:version/anchor`, documentId will always be a string. The check `typeof documentId !== 'string' || documentId.length === 0` — can documentId be an empty string? In NestJS routing, does `POST /anchors//1/anchor` actually match `:documentId/:version/anchor` with an empty documentId? Hmm, in Express, empty path segments generally don't match params. Actually, Express route `/anchors/:documentId/:version/anchor` — the request to `/anchors//1/anchor` would not match because `:` params don't match empty segments. So the empty string check might be defensive/unreachable via HTTP, but reachable if you call the method directly with `''`. Tests here will probably call the controller methods directly (unit tests) or via supertest.

2. `requireVersion`: `Number(raw)` — must be an integer. Note: `Number('')` is 0, which is an integer! So empty version param → 0. But again, via HTTP, empty params don't match. Via direct call, `requireVersion('')` → 0, passes validation. Hmm, that's a subtle bug candidate: empty string version parses to 0. Also `Number('1.5')` = 1.5, not integer → rejected. `Number('abc')` = NaN → rejected. `Number(' 1 ')` = 1 (whitespace trimmed) → accepted. `Number('0x10')` = 16 → accepted! That's a quirk: hex strings parse to integers. `Number('1e2')` = 100 → accepted. These are the "boundary values" and "error paths that look like success paths."

3. `requireContent`: body must be an object (non-null) with a 'content' field. Note: `typeof body !== 'object'` — arrays are objects, so an array body passes the `typeof` check but fails `'content' in body`? Actually, `'content' in [1,2]` is false (arrays don't have a 'content' property), so an array body → BadRequest. `body = null` → rejected. `body = undefined` → `typeof undefined !== 'object'` → rejected. `body = {}` → no 'content' → rejected. `body = { content: undefined }` → has 'content' key → passes, content is undefined. Then service's `canonicalize(undefined)` — what does that do? Per plan, canonicalize throws CanonicalizationError on non-serializable input. Is `undefined` JSON-serializable? `JSON.stringify(undefined)` returns `undefined` (not a string). The plan says canonicalize "returns canonical JSON… throws CanonicalizationError on non-serializable input." Presumably `undefined` would be handled — implementation-dependent. The controller test should perhaps verify that content passes through as-is (even undefined) — but that's service territory. For controller tests, the key is delegation: content is passed through unchanged.

4. Delegation: anchor calls `anchorService.anchorDocument(documentId, version, content)` and returns its result. verify calls `anchorService.verify(...)` and returns the result.

Also: the controller declares routes with `@Controller('anchors')` — kebab-case plural endpoint convention. Routes: `:documentId/:version/anchor` and `:documentId/:version/verify`. Hmm, the task says endpoints are kebab-case, plural. `anchors` is fine.

What would tests need? Per the plan's test list for the controller: "endpoint validation and delegation to service."

The repo convention says tests go in `test/<feature>.spec.ts`. The plan's manifest lists `test/anchor.controller.spec.ts`.

Now, how would these tests run against the implementation? Probably unit-style: instantiate `AnchorController` with a mocked `AnchorService` (spy), call methods directly, assert on validation errors and delegation arguments. Or use NestJS testing module with supertest. The plan says "endpoint validation and delegation to service" — likely direct method calls with a stub service.

Test cases to enumerate:

Validation branches:
1. anchor: valid input → delegates to `anchorDocument` with parsed (string documentId, integer version, content as-is) and returns the proof from the service. What would break: wrong argument mapping (e.g., version passed as string, content nested incorrectly), or return value not passed through.
2. anchor: non-integer version (e.g., '1.5') → BadRequestException, service not called. What would break: version parsing accepts floats, or service called with garbage.
3. anchor: non-numeric version (e.g., 'abc') → BadRequest, service not called.
4. anchor: empty documentId (direct call with '') → BadRequest, service not called. What would break: the empty check is missing.
5. anchor: missing/empty body (null, undefined, {}) → BadRequest, service not called.
6. anchor: body without 'content' field → BadRequest.
7. anchor: body that is an array or primitive (e.g., string, number) → BadRequest.
8. anchor: version '0' — is 0 a valid version? `Number('0')` = 0, integer → accepted. Boundary: version 0 should pass validation (versions could legitimately start at 1, but the controller shouldn't reject 0 — that's a business rule; the plan doesn't specify min version). Hmm, should we test that 0 is accepted? That's a boundary value. The plan doesn't say version must be positive. So the test would assert 0 passes through. What would break: someone adds `> 0` check, or treats 0 as falsy. Actually this is a good "boundary value" case: `version=0` must not be rejected by the controller (falsy-zero bug).
9. verify: same validation set — but do we need to duplicate every branch for verify? "A case per branch that could be wrong on its own." The validation helpers are shared, so a bug in `requireVersion` affects both. But the verify endpoint could theoretically have its own wiring mistake (e.g., verify calls anchorDocument, or returns mismatch shape wrong). I think we should include at least one validation case for verify (e.g., bad version → BadRequest) plus the delegation case. Duplicating all branches is probably overkill, but the instructions say "a case per branch that could be wrong on its own." The branches are in shared helpers; the per-endpoint wiring is what could differ. Let me include: verify delegates correctly (returns VerifyResult as-is, including `{ok:false}` shape — the "error path that looks like success path": a mismatch result is a 200, not an error — the controller must not convert `ok:false` to an HTTP error). That's a key case: verify with mismatch result returns it as-is (200), doesn't throw.
10. verify: content mismatch result `{ok:false, mismatch}` passes through unchanged — controller must not treat it as an error. What would break: controller inspects `ok` and throws, or reshapes it.
11. verify: service throws (e.g., ResourceNotFoundError) → propagates to caller (controller doesn't swallow). Hmm, is that a controller concern? The controller has no try/catch, so errors propagate. A test could prove the controller doesn't swallow service errors. But error mapping to the envelope is done by a global filter, out of scope for this spec? The plan says errors use a single envelope with HTTP mapping — but there's no exception filter in the manifest! Interesting: the plan mentions "HTTP mapping: 404 for resource_not_found, 409 for duplicate_anchor, 400 for hash_mismatch" but no filter file in the manifest. So that mapping is aspirational/unimplemented, or handled elsewhere (app.module?). We shouldn't test envelope mapping in the controller spec since no filter exists. I'll note as out of scope: "error envelope mapping (global exception filter) — no filter in this build; controller tests only assert that exceptions are thrown, not HTTP status codes."

12. Content passthrough: content is passed to service as-is — e.g., a nested object with unsorted keys, or `content: null`? Wait: `body = { content: null }` → `'content' in body` is true → passes, content = null. Then service canonicalizes null — `JSON.stringify(null)` = 'null', fine. So `{content: null}` is accepted by the controller and delegated with null. Is that a case? It's a boundary: content present but null. The controller should not reject it (it only checks for field presence). What would break: a truthiness check on content.

13. Version with whitespace or hex-like string? `Number(' 2 ')` = 2 accepted; `Number('0x1')` = 1 accepted. These are quirks of `Number()`. Should we test them? The "error path that looks like success" — '0x1' silently becoming 1. Hmm, but is that a spec? The plan says "version must be an integer." The implementation uses `Number(raw)`. Testing that '0x1' is accepted would lock in the quirk. I think it's better to test documented behavior: non-integer strings rejected, integers accepted. We could include a case that '1.5' (float) is rejected — that's the clearest float boundary. And maybe a case that the parsed integer is what the service receives (covered by delegation case).

14. Both endpoints: route path correctness? If we're using supertest/Nest testing module, we can test that `POST /anchors/doc1/2/anchor` reaches the handler and 404s elsewhere. But if tests call methods directly, route paths aren't exercised. The plan's manifest says "endpoint validation and delegation" — likely direct calls. But route registration is part of the controller's behavior… The task convention says endpoints are kebab-case plural — `anchors` is fine. I think it's worth one case if we use Nest testing module: the route is reachable at `POST /anchors/:documentId/:version/anchor`. But that depends on test harness choice. Hmm. The instructions say "list the test cases… don't write the tests." I can include a case that asserts routing works (via supertest) — "the anchor route is reachable at POST /anchors/{id}/{v}/anchor and returns the proof; GET or wrong path 404s." What would break: a typo in route template, wrong HTTP method decorator.

Actually, let me think about what's most defensible: the controller spec should test (a) validation rejects malformed input with BadRequest and does not call service; (b) valid input delegates with correctly parsed args and returns the service result unchanged; (c) verify's mismatch (ok:false) is returned as a success response, not thrown; (d) service exceptions propagate. Plus routing if using supertest.

Awkward cases requested: concurrency, duplicate delivery, exhaustion, boundary values, error paths that look like success.

For a controller:
- Duplicate delivery: hitting anchor twice — but that's service-level (DuplicateAnchorError). At controller level, duplicate POSTs would just delegate twice; the second would get the service's DuplicateAnchorError propagated. A controller test for "duplicate delivery" would be: second call lets the service's DuplicateAnchorError propagate unmodified (controller doesn't swallow or convert it). That's the "error path that looks like success" — actually duplicate is an error path. Hmm.
- Concurrency: two simultaneous anchor calls — controller is stateless; nothing to test beyond "no shared mutable state in the controller." We can note as out of scope: concurrency is a service/repository concern (unique index), not the controller's.
- Exhaustion: N/A for controller — note as out of scope.
- Boundary values: version 0, empty documentId (via direct call), large version number (e.g., '999999999999' — Number can handle up to 2^53; '1e21' → 1e21, integer? `Number.isInteger(1e21)` is true. So '1e21' passes validation and becomes 1000000000000000000000. That's a quirk — scientific notation accepted. Might be worth a case: version in scientific notation is… hmm, do we want to lock that in? Probably better to note as a known quirk and not test, or test that it's rejected? The implementation accepts it. Tests "test behavior, not implementation" — the behavior here is what `Number()` does. Since the plan doesn't specify, I'll flag it: don't test '1e21'/'0x1' acceptance as a requirement; instead, note in the closing line as deliberately not tested (implementation quirk of Number(); spec only requires integer).

Actually wait — should a case assert that non-integer strings like '1.5', 'abc', '' are rejected? Empty string: via direct call `requireVersion('')` → Number('') = 0 → accepted. That's a real bug candidate! Empty version param → version 0. Via HTTP, Express won't match empty segments, so unreachable via route; but the controller method is directly callable. Is this worth a case? "Boundary value: empty version string" — the current code accepts it as 0. If we write a test asserting it's rejected, the test would fail against the current implementation. The task says these tests "run against" the shown implementation — presumably they should pass (the list is for tests to be written next, presumably to verify correct behavior). Hmm, but the instructions also say "what would have to be broken for it to fail" — implying tests should pass against correct code and fail against broken code. If the implementation has a latent bug (empty version → 0), do we write a test that exposes it (fails) or not?

The framing: "PLAN.md above is your own spec, and the implementation files shown read-only are what these tests run against." So the tests will be written to match plan + implementation. The list should cover behavior that matters per plan. The empty-string-version quirk is unreachable via HTTP routing (Express doesn't match empty segments), so it's not a behavior worth locking in either way. I'll mention in the closing "not testing" line: "empty version param via direct call (parses to 0) — unreachable through the route because Express does not match empty path segments; locking it in either way would be over-specification."

Hmm, actually, let me double-check: does Express match `/anchors//1/anchor` against `/anchors/:documentId/:version/anchor`? In Express 4, `:param` matches `[^/]+` — one or more non-slash chars. So an empty segment doesn't match. Correct, unreachable via HTTP.

Now, the "error path that looks like success" for this controller: `verify` returning `{ok:false, mismatch}` — HTTP 200 with a mismatch body. A naive controller might throw on `ok:false`. That's the key awkward case.

Also `anchorDocument` per plan: "returns proof once confirmed; if not yet confirmed, returns proof with current known fields (txId set, blockNumber pending)." Wait — but the plan's `AnchorProof` interface is `{ documentId, version, contentHash, txId, blockNumber }` with `blockNumber: number` (non-nullable). And step 6 says "returns proof with current known fields (txId set, blockNumber pending) — worker completes it." Contradiction: if not confirmed, blockNumber is null but the type says number. Hmm. Actually re-reading: "6. returns proof once confirmed; if not yet confirmed, returns proof with current known fields (txId set, blockNumber pending) — worker completes it." This is ambiguous/contradictory with the type. But that's a service concern, not controller. The controller just passes through whatever the service returns. So the controller test for anchor: returns exactly what `anchorDocument` resolves to. Fine.

Let me also think about whether the controller spec should test with a real service + fake chain (integration-ish) or a stubbed service. The plan's manifest: `test/anchor.controller.spec.ts | reads: src/anchor/anchor.controller.ts | endpoint validation and delegation to service`. Only reads the controller — so stubbed service. Good: unit-level with a mock AnchorService.

Cases (one per line):

1. `anchor delegates parsed input and returns the proof` — POST anchor with valid documentId, integer version, content object → `anchorDocument` called exactly once with (documentId string, version as number, content as-is); returned proof is the service's result object unchanged. Fails if: args are remapped (version stays a string, content is re-wrapped), or the return value is reshaped/filtered.

2. `anchor rejects a non-integer version without calling the service` — version '1.5' (or 'abc') → BadRequestException; `anchorDocument` never called. Fails if: validation is skipped or the float is truncated/rounded before delegation.

Hmm, should '1.5' and 'abc' be separate cases? "A case per branch that could be wrong on its own." The branches in requireVersion: `Number(raw)` → NaN or non-integer → throw. Both 'abc' (NaN) and '1.5' (non-integer) hit the same `!Number.isInteger` check — one branch. So one case suffices; use '1.5' as it's the nastier one (looks numeric). Actually, NaN vs non-integer: `Number.isInteger(NaN)` is false, `Number.isInteger(1.5)` is false — same branch. One case.

3. `anchor rejects an empty documentId` — direct call with documentId '' → BadRequest, service not called. Fails if: the empty-string guard is missing (only undefined/typeof checked). Note: unreachable via HTTP but guards the helper. Hmm — should we include? The code has this branch; a test per branch that could be wrong on its own. Yes, include, and note it's exercised via direct method call since the route can't produce an empty segment.

4. `anchor rejects a body that is not an object or lacks content` — body null / undefined / {} / 'string' → BadRequest, service not called. Multiple sub-cases; one line can enumerate the shapes: null, primitive, missing 'content' key. Branches: `typeof body !== 'object' || body === null` and `!('content' in body)`. Two branches → maybe two cases: (a) non-object body (null, string, number); (b) object without 'content'. Also array body: typeof [] === 'object', `'content' in []` false → rejected by the second branch. Include array in (b) as a nastier shape.

5. `anchor accepts a present-but-null content and delegates it` — body `{content: null}` → service called with `null`. Fails if: a truthiness check on content rejects it, or null is coerced to undefined. Boundary value case.

6. `anchor passes version 0 through (falsy boundary)` — version '0' → service called with 0, not rejected. Fails if: validation uses a truthiness check (`if (!version)`) that swallows 0.

7. `anchor propagates service errors unchanged` — stub `anchorDocument` rejects with DuplicateAnchorError (or CanonicalizationError) → the controller's promise rejects with the same error instance; no wrapping, no catch. Fails if: the controller swallows/transforms service errors (e.g., converts to BadRequest), breaking the envelope contract downstream. This covers duplicate delivery at the controller level: a second anchor for the same pair surfaces the service's duplicate error, not a success.

8. `verify delegates and returns the ok result unchanged` — valid input, service resolves with `{ok:true, proof}` → returned as-is. Fails if: verify is wired to the wrong service method (e.g., anchorDocument) or the result is reshaped.

9. `verify returns a mismatch result as a success, not an error` — service resolves with `{ok:false, mismatch:{...}}` → controller returns it (resolves), does not throw. Fails if: the controller inspects `ok` and throws/converts mismatch to an exception — the "error path that looks like success" inverted: a failure report must travel as a normal response.

10. `verify rejects malformed input like anchor does` — e.g., non-integer version or missing content → BadRequest, `verify` never called. Fails if: verify endpoint skips validation (only anchor validates) — per-endpoint wiring divergence. One case suffices since the helpers are shared; pick one shape (bad version) to prove the verify path goes through the same guards.

11. `verify propagates ResourceNotFoundError unchanged` — service rejects with ResourceNotFoundError → controller rejects with the same instance. Fails if: verify's error path is caught or converted (e.g., to a mismatch report), hiding "no anchor" from the API layer.

12. Route/routing case (if supertest): `POST /anchors/:documentId/:version/anchor and /verify are the only routes` — a request to the exact path reaches the handler; GET or a wrong subpath 404s. Fails if: route template typo, wrong method decorator, or 'anchors' not plural/kebab. Hmm — do we want this? The plan's manifest line says "endpoint validation and delegation" — routing is arguably part of the controller. I'll include one case for route reachability + wrong method 404, noting it requires the Nest testing module (supertest). Actually, the convention is tests test behavior… routing is behavior. Include it, but keep to one line.

Hmm wait, also: does the controller validate that `params` exists? If called directly with undefined params, `requireDocumentId(undefined)` → typeof undefined !== 'string' → BadRequest. That's covered by the "non-string documentId" branch — but via HTTP it can't happen. Should I fold into case 3 (empty/missing documentId)? Let me phrase case 3 as "empty or missing documentId."

Also, negative version: '-1' → Number = -1, integer → accepted. Should the controller reject negative versions? Plan doesn't say versions are positive. So -1 passes — same as 0 case. Fold into the falsy-boundary case? No — -1 isn't falsy. Should we test that -1 is accepted? That locks in "no positivity rule." The plan's NewAnchor has version Int with no constraint. I think one boundary case (0) is enough; mention in closing line that we don't assert positivity/negativity policy because the plan doesn't specify it (controller must not invent business rules).

Now, the closing "not testing" line. Candidates:
- Error envelope/HTTP status mapping (409/404/400) — no exception filter in this build; controller only throws, mapping is global-filter territory (and not in the manifest).
- Concurrency/duplicate delivery beyond error propagation — exactly-one-anchor is enforced by the unique index and proven in the service spec's crash test; the controller is stateless so there's no controller-level concurrency behavior.
- Exhaustion/limits — no limit logic in the controller.
- Version string quirks of Number() ('0x1', '1e21', ' 2 ') — implementation quirk, spec only says integer; locking them in would over-specify.
- Canonicalization/hashing behavior — service/canonical spec's job.

The instructions say: "name what you deliberately are not testing and why, in a single closing line." One line. I need to compress into one line. E.g.: "Deliberately not testing: HTTP status/envelope mapping (no exception filter in this build — the controller only throws), concurrency and duplicate-delivery semantics (stateless controller; exactly-one-anchor is proven by the unique index in the service spec), version-string quirks of Number() like '0x1' or ' 2 ' (implementation quirk, spec only requires integer), and hashing/canonicalization (canonical.service's job)."

That's one line (long, but one line).

Let me also double-check the "what would have to be broken" for each case — each line must name a concrete failure mode.

Also, should I include a case that the anchor endpoint returns a proof even when not yet confirmed (blockNumber pending)? That's service behavior; the controller just passes through. The pass-through case covers "returns exactly what the service resolves to" — I can phrase case 1 as "returns the service's resolved value unchanged, whether confirmed or pending." Good.

One more: body `{content: {...}}` where content itself is an object — passthrough identity. Covered in case 1 ("content as-is"). Should I assert reference equality or deep equality? "As-is" — deep equality suffices; reference equality would be an implementation assertion. Keep as "unchanged."

Also, a case for: anchor with valid input but service resolves — assert called exactly once (no double delegation, no retry loop in controller). Fold into case 1: "called exactly once."

Let me also reconsider whether to separate "non-object body" and "object without content" — they're separate `||`/`!in` branches, each could be wrong independently (e.g., someone changes to `if (!body?.content)` which would also reject `{content: null}` and `{content: 0}`… wait, that's a different bug). Case 5 (null content accepted) guards against the truthiness regression. Good, that's a nice trio: case 4a (null/primitive body rejected), 4b (object without content key rejected, including array), 5 (present-but-null content accepted).

Hmm, also `{content: 0}` or `{content: false}`? Same branch as null — presence check. One representative (null) is enough; I can mention "present-but-falsy content (e.g., null, 0)" in case 5.

Now the count: aim for ~10-12 cases. Let me finalize:

1. anchor: valid request delegates parsed args and returns proof unchanged — proves arg mapping (string id, integer version, content as-is) and pass-through of the service result (confirmed or pending proof); fails if version is left a string, content re-wrapped, or the result reshaped.

2. anchor: non-integer version rejected, service untouched — '1.5' (and NaN inputs like 'abc') → BadRequest; fails if the float is truncated/rounded or validation skipped.

3. anchor: empty/missing documentId rejected, service untouched — '' or undefined via direct call → BadRequest; fails if only the typeof check exists without the length check (or vice versa).

4. anchor: non-object body rejected — null, undefined, string, number → BadRequest, no delegation; fails if the guard is `if (!body)` (which would also let… wait, `!body` rejects null and undefined and '' but lets {} through — different failure) — let me phrase: fails if the guard is a truthiness check or missing, letting primitives/null reach the service.

5. anchor: object body without a 'content' key rejected — {} and array body (typeof object but no key) → BadRequest; fails if the check is `body.content !== undefined` style… hmm, actually `'content' in body` vs `body.content !== undefined`: for `{}`, both reject. For arrays, both reject. Where do they differ? `{content: undefined}` — `'content' in` accepts, `!== undefined` rejects. That's the distinguishing input! So case 5 should use `{content: undefined}`? But then case 5 and a "content explicitly undefined" case… Let me restructure:

- Case A (non-object body): null/undefined/primitive → rejected.
- Case B (no content key): {} and [1,2] → rejected.
- Case C (content present but null/undefined): `{content: null}` accepted and delegated as null — guards against truthiness/`!== undefined` regression.

Three cases, each with a distinct failure mode. Good.

6. anchor: version '0' accepted and delegated as 0 — falsy boundary; fails if validation truthiness-checks the parsed version.

7. anchor: service rejection propagates unchanged — stub rejects with DuplicateAnchorError (the duplicate-delivery case: second anchor for the same pair) → controller rejects with the same instance; fails if the controller catches/wraps/converts service errors (e.g., to BadRequest), breaking the error contract.

8. verify: valid request delegates and returns `{ok:true, proof}` unchanged — fails if verify is wired to the wrong service method or reshapes the result.

9. verify: `{ok:false, mismatch}` returned as a normal success — controller must not throw on ok:false; fails if the controller inspects the result and converts a mismatch into an exception (or vice versa, drops the report).

10. verify: malformed input rejected before delegation — bad version (or missing content) → BadRequest, `verify` never called; fails if only the anchor endpoint runs the guards.

11. verify: ResourceNotFoundError propagates unchanged — "no anchor" is an error, not a mismatch report; fails if verify's catch path converts it to `{ok:false}` or swallows it.

12. Routing: POST /anchors/:documentId/:version/anchor and .../verify reachable; GET or unknown subpath 404 (via supertest) — fails if route template/method is wrong or 'anchors' isn't the declared base. Hmm, is this worth it? It's a real controller behavior (decorators). Include — the task convention emphasizes endpoint shape. But if the test harness is direct calls, this doesn't fit. The plan's manifest says "endpoint validation and delegation" — I'll keep the routing case but phrase it so it's optional… no, the list should be decisive. The controller's decorators are part of what "could be wrong on its own" (a typo in the route would pass all direct-call tests). Include it.

Actually, wait — let me reconsider. If tests use Nest's TestingModule + supertest, then cases 1-11 could also go through HTTP. But "delegation to service" is easier with a stubbed service via TestingModule override. Either way, the list holds: validation + delegation + propagation + routing. Fine.

Closing not-testing line (one line): "Deliberately not testing: HTTP status codes and the error envelope (no exception filter ships in this build — mapping 409/404/400 is global-filter territory, and the controller only throws); concurrency, duplicate delivery, exhaustion (the controller is stateless — exactly-one-anchor is proven by the unique index and crash test in the service spec); Number() quirks for version strings like '0x1', ' 2 ', '1e21' (implementation quirk; the spec only requires integer, and locking the quirks in would over-specify); and hashing/canonicalization behavior (canonical spec's job)."

That's one line. Good.

Format check: "one line per case, in this shape: `- <name of the test> — <what it proves, and what would have to be broken for it to fail>`". Use em dash. Name the test — should read like a test name (e.g., "anchor rejects a non-integer version without delegating"). Keep names imperative/descriptive.

Also, rule: "reply with the list and nothing else." So no preamble, no headings. Just the lines. The closing line is part of the reply — "name what you deliberately are not testing and why, in a single closing line." So the last line is that. Should it also be a list item? "In a single closing line" — I'll make it a final bullet starting with "Not testing:" to keep the shape consistent.

Let me also double-check case 3: is `requireDocumentId` reachable with undefined? Via direct call, yes. Via HTTP, @Param always gives a string for a matched route. So "empty or missing documentId" via direct call. Fine.

One more consideration: the plan says the controller "validates input shape, delegates to service; zero business logic." So a test that the controller does no hashing (e.g., doesn't call canonicalize)? That's an implementation assertion — skip.

Also, should a case assert BadRequestException specifically (vs generic Error)? The controller throws BadRequestException. A test would assert the thrown type is BadRequestException (which Nest maps to 400). I'll mention "BadRequest" in the failure conditions where relevant.

Let me also verify case 2's failure mode: "what would have to be broken" — if `Number('1.5')` were coerced with `parseInt` (→ 1) or `Math.round`, the float would slip through as an integer; or if validation were removed. Good.

Case 6's failure: `if (!version)` after parsing — 0 rejected. Good.

Case 7's failure: controller wraps in try/catch and rethrows as something else, or returns a default. Also "duplicate delivery": two rapid identical POSTs — the controller delegates both; the second surfaces the service's DuplicateAnchorError. At the controller level, we can only test propagation (the stub rejects on the second call). I'll phrase it: "a second anchor for an already-anchored pair (service rejects with DuplicateAnchorError) propagates unchanged — the controller adds no retry, no dedup of its own." Fails if: the controller retries on error, swallows it, or transforms it.

Hmm, "no retry" — can a controller test prove no retry? Yes: stub rejects once; assert called exactly once. Fold into case 7: "the service is called exactly once and the same error instance surfaces."

Let me write the final list. Keep each line reasonably terse but complete.

Final check on ordering: group anchor cases, then verify cases, then routing, then closing line.

Names (test-name style):
1. `anchor delegates parsed parameters and returns the proof unchanged`
2. `anchor rejects a non-integer version without delegating`
3. `anchor rejects an empty or missing documentId without delegating`
4. `anchor rejects a non-object request body without delegating`
5. `anchor rejects an object body with no content key (including arrays)`
6. `anchor accepts a present-but-null content and delegates it as null`
7. `anchor passes version "0" through as the integer 0`
8. `anchor propagates a service rejection (duplicate pair) unchanged and without retry`
9. `verify delegates and returns an ok result unchanged`
10. `verify returns a mismatch report as a success, not an error`
11. `verify rejects malformed input before delegating`
12. `verify propagates ResourceNotFoundError unchanged`
13. Routing case: `the anchor and verify routes are reachable only via POST at /anchors/:documentId/:version/…`

13 cases + closing line. Good coverage without bloat.

Wait — one more: should I have a case that both endpoints share the base path 'anchors' (kebab-case plural convention)? The routing case covers reachability; the convention is about naming. Fine, fold into case 13's failure condition: "fails if the base path is not 'anchors' or the subpaths are misspelled."

Also, should I worry about `@Param()` typing when the route doesn't match? Covered by 404 in case 13.

Em dash usage: the template shows `—`. Use it between name and explanation.

Now let me write it out.
```

## reply

- `anchor delegates parsed parameters and returns the proof unchanged` — proves that a valid request (`documentId` string, integer `version`, `content` object) reaches `anchorDocument` exactly once with the version converted to a number and the content passed through untouched, and that whatever the service resolves (confirmed proof or pending proof) is returned unmodified; fails if the version stays a string, the content is re-wrapped or reordered, the service is called more than once, or the result is reshaped/filtered.
- `anchor rejects a non-integer version without delegating` — proves `version: "1.5"` (and NaN inputs like `"abc"`) is answered with a BadRequest and `anchorDocument` is never invoked; fails if the value is coerced with `parseInt`/rounding so a float slips through as an integer, or if validation is skipped and the raw string reaches the service.
- `anchor rejects an empty or missing documentId without delegating` — proves `""` or `undefined` (direct method call, since the route cannot produce an empty segment) yields a BadRequest with no delegation; fails if only the `typeof` check exists without the empty-length check (or vice versa), letting an empty id reach the service.
- `anchor rejects a non-object request body without delegating` — proves `null`, `undefined`, a string, or a number body yields a BadRequest and no delegation; fails if the guard is a truthiness check like `if (!body)` (which mishandles `0`/`""`-style bodies) or is missing, letting a primitive reach the service.
- `anchor rejects an object body with no content key, including arrays` — proves `{}` and `[1, 2]` (an array is `typeof "object"` but has no `content` key) yield a BadRequest and no delegation; fails if the check is dropped or replaced with something that only inspects `body.content` loosely, letting keyless bodies through.
- `anchor accepts a present-but-null content and delegates it as null` — proves `{ content: null }` passes validation and the service receives `null`, not a rejection; fails if validation truthiness-checks the content or uses `body.content !== undefined`, rejecting a legitimately present field.
- `anchor passes version "0" through as the integer 0` — proves the falsy boundary is not special-cased: `"0"` validates and the service receives `0`; fails if validation does `if (!version)` after parsing, silently rejecting version 0.
- `anchor propagates a service rejection (duplicate pair) unchanged and without retry` — proves that when the service rejects with `DuplicateAnchorError` (the duplicate-delivery case: a second anchor for an already-anchored pair), the controller's promise rejects with that same error instance and the service was called exactly once; fails if the controller catches, wraps, or converts service errors (e.g., into a BadRequest), or retries — either way the downstream error contract breaks.
- `verify delegates and returns an ok result unchanged` — proves a valid verify request reaches `verify` with the same parsed arguments and `{ ok: true, proof }` comes back unmodified; fails if the endpoint is wired to the wrong service method (e.g., `anchorDocument`) or the result is reshaped.
- `verify returns a mismatch report as a success, not an error` — proves `{ ok: false, mismatch: { expectedHash, providedHash } }` resolves as a normal response; fails if the controller inspects `ok` and throws on a mismatch (or drops the report) — the failure-looking result that must travel as a success.
- `verify rejects malformed input before delegating` — proves the verify endpoint runs the same guards (e.g., a non-integer version or a body without `content` yields a BadRequest and the service is never called); fails if only the anchor endpoint validates and verify delegates raw params straight through.
- `verify propagates ResourceNotFoundError unchanged` — proves "no anchor exists for this pair" surfaces as the service's `ResourceNotFoundError`, not as a mismatch report; fails if verify's error path is caught and converted to `{ ok: false, ... }` or swallowed, hiding a missing anchor from the API layer.
- `the anchor and verify routes are reachable only via POST at /anchors/:documentId/:version/anchor and /verify` — proves the declared base path is plural kebab-case `anchors`, the subpaths are spelled as in the decorators, and GET or an unknown subpath 404s; fails if a route template is misspelled, the method decorator is wrong, or the base path drifts from `anchors` — a typo no direct-call delegation test would catch.

Deliberately not testing: HTTP status codes and the error envelope (no exception filter ships in this build, so 409/404/400 mapping is global-filter territory and the controller only throws); concurrency, duplicate delivery, and exhaustion (the controller is stateless — exactly-one-anchor is proven by the unique index and the crash test in the service spec); `Number()` quirks for version strings such as `"0x1"`, `" 2 "`, or `"1e21"` (implementation quirk; the spec only requires an integer, and locking the quirks in would over-specify); and hashing/canonicalization behaviour (the canonical spec's job).

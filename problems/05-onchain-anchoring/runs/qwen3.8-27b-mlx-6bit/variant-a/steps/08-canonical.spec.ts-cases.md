# 08-canonical.spec.ts-cases

## reasoning

```
Let me analyze the task. I need to enumerate test cases for `test/canonical.spec.ts`. This is a spec list, not actual tests. The file under test is `src/anchor/canonical.ts`, which contains:

- `CanonicalizationError` class
- `canonicalize(value: unknown): string` — canonical JSON: keys sorted at every level, arrays preserve order, no whitespace, UTF-8. Throws `CanonicalizationError` for non-JSON-representable values.
- `hashContent(value: unknown): string` — SHA-256 hex of canonical form.
- `normalize` (internal): handles null, string, boolean, number (finite check), bigint (throw), function (throw), symbol (throw), undefined (throw), arrays (preserve order), objects (sort keys). Cycle detection via a seen set. Shared references (DAGs) allowed — removed after children are processed, so DAGs get serialized again, true cycles throw.

The plan says tests for `test/canonical.spec.ts` should cover:
- Determinism of `hashContent`: same content in different key orders yields the same hash; different content yields a different hash.
- `hashContent` throws `CanonicalizationError` for non-serializable input (e.g. circular references).

The task statement says: "Compute a canonical hash of the structured content (define canonicalization; PDF is rendering, not source of truth)." So canonicalization must be deterministic and order-independent.

Rules for the list:
- One line per case, format: `- <name of the test> — <what it proves, and what would have to break for it to fail>`
- Cover behavior the task asks to be tested, and behavior the plan says matters. One case per branch that could be wrong on its own.
- State what would have to break.
- Include awkward cases: concurrency (probably not relevant here — this is a pure function; but "duplicate delivery" analog would be... hmm, for a pure function maybe not applicable; but I should think about what awkward cases apply: boundary values, error paths that look like success paths).
- Close with one line naming what I deliberately am not testing and why.

Let me enumerate branches in `canonicalize`/`normalize`:

1. Top-level null → `"null"`.
2. Strings pass through (including Unicode — UTF-8 handling; JSON.stringify escapes some characters but preserves Unicode; hash is over UTF-8 bytes).
3. Booleans pass through.
4. Finite numbers pass through (e.g. 0, -0? Interesting: JSON.stringify(-0) → "0". Boundary: 0 vs -0 collapse. Also large numbers, floats like 1e21 → "1e+21". These are JSON.stringify semantics — probably shouldn't over-specify, but a boundary-value case: numbers are serialized per JSON.stringify semantics, e.g. 1e21 → "1e+21". Hmm, do I want to pin that down? It's a boundary value. The test could assert canonicalize(1e21) === '1e+21'. What would have to break: if someone hand-rolls number formatting instead of delegating to JSON.stringify, or if they change it. That's a legitimate boundary case.)
5. Non-finite numbers (NaN, Infinity, -Infinity) → throw CanonicalizationError. Error path that looks like success: JSON.stringify actually converts NaN to "null"! So if the code didn't guard, canonicalize(NaN) would return "null" — indistinguishable from canonicalize(null). That's the "error path that looks like success path" case.
6. BigInt → throw (JSON.stringify throws on BigInt natively, but the code catches and rethrows as CanonicalizationError; if the guard were removed the error would be a plain TypeError, not CanonicalizationError — so the test proves the error type contract).
7. Function → throw. Note: JSON.stringify of a top-level function returns undefined, not a string! canonicalize(() => {}) — normalize throws before stringify. If the guard were removed, JSON.stringify(fn) returns undefined and canonicalize would return undefined (violating the string return type). Also functions inside objects are silently dropped by JSON.stringify — so the guard matters: {a: 1, f: () => {}} must throw, not silently drop the key. That's an important "silent data loss" case.
8. Symbol → throw (JSON.stringify also silently drops symbol keys and top-level symbols return undefined).
9. undefined → throw (top-level undefined: JSON.stringify returns undefined; inside object: {a: undefined} silently drops the key — silent data loss).
10. Arrays preserve order: [2,1] vs [1,2] must have different canonical forms/hashes. What would break: if someone "canonicalized" arrays by sorting them (a common mistake), order would be lost and [1,2] would hash the same as [2,1].
11. Objects sort keys at every level (nested): {b: {d: 1, c: 2}, a: 3} → {"a":3,"b":{"c":2,"d":1}}. What would break: if only top-level keys are sorted (shallow sort), nested order would depend on insertion order.
12. Key-order invariance: {a:1,b:2} and {b:2,a:1} → same canonical string, same hash. What would break: if keys aren't sorted at all (insertion order preserved), different insertion orders would yield different hashes — breaking the core purpose (auditors verifying years later from independently constructed content).
13. No whitespace: canonical form has no spaces — JSON.stringify by default has none, but if someone used a pretty printer (2-space indent), the hash would change. What would break: using JSON.stringify with a space argument.
14. Determinism of hashContent: same input twice → same hash. Different content → different hash (e.g. {a:1} vs {a:2}). Also hash is 64-char lowercase hex (SHA-256). What would break: using a different algorithm or uppercase hex, or non-determinism (e.g. including a timestamp or object identity).
15. Circular reference → throw CanonicalizationError (a.self = a). What would break: if cycle detection is missing, normalize would recurse infinitely (stack overflow / RangeError), not a clean CanonicalizationError.
16. Shared reference (DAG, not cycle) → allowed, serialized twice: const x = {v:1}; canonicalize({a: x, b: x}) === '{"a":{"v":1},"b":{"v":1}}'. What would break: if the seen set isn't removed after children are processed (i.e. treats any repeated reference as a cycle), DAGs would throw; or if it's kept, the second occurrence would be dropped. This is a subtle branch: the comment in the code explicitly says it's intentional.
17. Self-cycle via array: const a: any[] = []; a.push(a) → throw.
18. Indirect cycle: a.b = c; c.a = a → throw. (Could be merged with 15, but "one case per branch that could be wrong on its own" — self-cycle and indirect cycle both exercise the same seen-set logic; probably one case is enough, but indirect cycle via nested objects is a separate shape. I'll include both self-cycle and DAG; indirect cycle might be merged into the cycle case as an example. Actually let me keep them separate: self-cycle and indirect cycle both test the seen set, but a bug could handle one and not the other? The seen-set logic is identical for both. I'd say one cycle case (indirect, which subsumes self) — but self-cycle is the classic. I'll list "circular structure throws" and mention both direct and indirect in the description. Hmm, one line per case though. Let me do: "direct self-reference throws" and "indirect cycle through nested objects throws"? That might be overkill. The rule says one case per branch that could be wrong on its own. Direct and indirect cycles go through the same branch (seen.has). I'll do one case covering circular references with a mention that both direct and indirect are exercised. Actually, to be safe and specific, I could name one test "rejects circular references (direct and indirect)". That's fine.)
19. Unicode strings: "héllo" / emoji — hash is over UTF-8 bytes; canonical form preserves characters (JSON.stringify doesn't escape non-ASCII by default). What would break: if the implementation escaped Unicode (e.g. \u00e9) or hashed the JS string as UTF-16 instead of UTF-8 — two implementations would disagree. The plan says "UTF-8" explicitly, so a case pinning UTF-8: hashContent of a non-ASCII string equals the SHA-256 of its UTF-8 bytes. This is a real cross-language determinism concern (auditors in other languages). Good case.
20. Empty object {} → "{}", empty array [] → "[]". Boundary values. What would break: if empty containers are rendered as null or dropped.
21. Top-level primitive: canonicalize(42) === "42", canonicalize("x") === '"x"'. Boundary: top-level is not necessarily an object. What would break: if the code assumes an object (e.g. Object.keys on a number → [] → "{}").
22. Whitespace/meaningful differences: "a b" vs "ab" are different — probably not needed.
23. Numbers: 1 vs 1.0 — in JS both are the same number; not applicable.
24. -0: JSON.stringify(-0) → "0". So canonicalize(-0) === "0", same hash as 0. Is that desirable? In JSON, -0 and 0 are... actually the JSON spec permits -0. JS's JSON.stringify maps -0 to "0". If the plan wanted strictness, it might treat -0 as distinct. But the implementation delegates to JSON.stringify, so -0 collapses to 0. Should I pin this in a test? It's a boundary value. Pinning it documents the behavior; what would break: if someone switches to a serializer that emits "-0". I think it's a legitimate awkward boundary case. But is it "behavior the plan says matters"? The plan says canonical form = sorted keys, arrays preserved, no whitespace, UTF-8, SHA-256. Number formatting isn't specified beyond JSON semantics. Pinning -0 might be over-specification, but the rules ask for boundary values. I'll include it as documenting that numeric formatting follows JSON.stringify (e.g. -0 → "0", 1e21 → "1e+21"). Hmm, I can combine into one "number formatting follows JSON semantics" case. Let me think whether that's a good test: it proves the hash is stable against a reference implementation (e.g. Python's json.dumps with sort_keys? no — Python formats 1e21 as 1e+21 too... actually Python: json.dumps(1e21) → '1e+21'. Yes, same. -0: Python json.dumps(-0.0) → '-0.0'. Different! So cross-language, -0 diverges. But clinical report content is unlikely to contain -0. I'll keep the number-formatting case but frame it as "delegates to JSON.stringify semantics" — what would break: if someone hand-rolls number formatting. Actually, I might drop -0 and just do one boundary: large exponent numbers serialize in exponential form. Hmm. Let me include a single "boundary values" case: empty object/array, top-level primitives, and exponent-form numbers. But the rule is one line per case, one branch per case. Empty object and top-level primitive are separate branches (the 'object' case with no keys vs the non-object typeof). I'll list them separately:
   - Top-level primitive (number/string/boolean/null) serializes as JSON literal.
   - Empty object and empty array render as "{}" and "[]".
   - Large numbers use JSON exponential notation (1e21 → "1e+21") — pins that we delegate to JSON.stringify rather than hand-rolling.

25. Error type contract: all rejections throw `CanonicalizationError` (instanceof), not a raw TypeError/RangeError. What would break: if the catch in canonicalize doesn't rewrap, or if guards are removed and JSON.stringify throws a native TypeError for BigInt. This is important: the service layer (per plan) maps CanonicalizationError to a 400; a raw TypeError would crash or become a 500. So a case: "throws CanonicalizationError (not a raw TypeError) for BigInt" etc. I can fold the type assertion into each error case, or have one explicit case. The plan says "hashContent throws CanonicalizationError for non-serializable input (e.g. circular references)." I'll assert instanceof in each error case, and maybe have one explicit case for the error class name/contract. Let me keep it: each error case states "throws CanonicalizationError". And one case that the error is an instance of Error with name set? Overkill. I'll fold it in.

26. "Error path that looks like success path": NaN → without the guard, JSON.stringify(NaN) === "null", so a buggy version would hash NaN identically to null. The test proves canonicalize(NaN) throws rather than returning "null". This is exactly the awkward case the rules ask for. Also undefined inside an object: {a: undefined} silently drops → hash equals {} — silent data loss. And a function inside an object is silently dropped similarly. These are the "looks like success" ones: no exception, wrong (lossy) output. Good to have explicit cases:
   - NaN/Infinity throw rather than being serialized as null (JSON.stringify's silent conversion).
   - undefined/function/symbol members are rejected rather than silently dropped (JSON.stringify's silent omission) — prevents hash({a:1, f:fn}) === hash({a:1}).

27. Arrays of objects: sort keys inside array elements too: [{b:1,a:2},{a:3,b:4}] → '[{"a":2,"b":1},{"a":3,"b":4}]'. This is "every level" including inside arrays. What would break: if sorting is only applied to top-level object keys or if array elements aren't normalized. Could merge with the "every level" nested case, but arrays-of-objects is a distinct path (the Array branch calls normalize on items). I'll include it as its own case: "object keys are sorted inside array elements too".

28. Duplicate keys? JS objects can't have duplicate literal keys (last wins). Not applicable.

29. Determinism across runs / no hidden state: calling canonicalize twice on the same value yields identical output; and mutation of the input after canonicalize doesn't affect the prior result (since we rebuild). Hmm, "rebuild" means the output is a new structure; stringify happens immediately. A case: canonicalize returns a fresh canonical string and is not affected by later mutation of the input object. What would break: if the implementation cached or returned a reference to the input's serialization. Weak, but a real property: purity. Maybe include as "pure: repeated calls are identical and later input mutation doesn't change prior output". I think it's worth one line — it's the "duplicate delivery" analog: anchoring the same content twice must produce the same hash (idempotent hashing). Actually that's covered by determinism. I'll fold purity into the determinism case: "two calls with equal content (fresh objects, different insertion order) hash identically".

30. Hash format: 64 lowercase hex chars. What would break: uppercase hex, base64, or a different digest length (MD5 = 32). The plan says SHA-256 hex. A case: "hashContent output is 64-char lowercase hex (SHA-256)". Good, cheap, pins the contract.

31. Different content → different hash: {a:1} vs {a:2}, and also {a:1,b:2} vs {b:2,a:1} are the same (covered). Collision resistance isn't testable; just distinctness for different inputs. What would break: if the hash is computed over something that doesn't include the content (e.g. hashing a constant or the string "content"), different contents would collide.

32. Whitespace in input strings is significant: "a b" vs "a  b" are different hashes — canonicalization must not trim/normalize string values. What would break: if someone "normalizes" whitespace inside strings (over-canonicalization). This is a good negative case: canonicalization must not alter string values. I'll include it.

33. Boolean vs string "true": different hashes — trivially covered by distinctness; skip.

34. Deep nesting: many levels — stack overflow? normalize is recursive; very deep structures (10k levels) would stack-overflow with a RangeError, not CanonicalizationError. Is that in scope? The plan doesn't mention depth limits. Testing a 10k-deep structure expecting... what? The spec doesn't define behavior for deep input. I shouldn't pin undefined behavior. But "exhaustion" is listed as an awkward category. Hmm — for a pure function, exhaustion = deep recursion. The code has no depth cap; the behavior would be RangeError (not CanonicalizationError). Pinning that would be over-specification. I'll put it in the "not testing" line: not testing depth limits / very large payloads, because the plan doesn't define a bound and pinning stack-overflow behavior would over-specify. Good use of the closing line.

35. Concurrency: pure synchronous function — no concurrency concerns. I'll note in the closing line that I'm not testing concurrency because canonicalize/hashContent are pure and synchronous (no shared state, no async). The rules say to include awkward cases like concurrency — but if not applicable, the closing "not testing" line is where I name it with a reason. Yes: "Not testing concurrency or async interleaving: canonicalize and hashContent are pure, synchronous, and stateless — there is no shared state to race."

Now, mapping to the plan's test section for canonical.spec.ts: "determinism, order-independence, error on non-serializable". My list covers those plus the branches.

Let me also double-check the `seen` set logic for correctness, so I name the right failure modes:

- normalize adds record to seen before processing children, removes after. So during processing of a node's subtree, that node is "in progress". A repeated reference encountered while the first is still in progress = cycle → throw. A repeated reference after the first completed (sibling sharing) = not in seen → serialize again. Correct DAG behavior.
- Bug mode 1: never remove from seen → sibling sharing throws (false-positive cycle). Test: DAG case.
- Bug mode 2: remove before processing children (or never add) → cycle not detected → infinite recursion / stack overflow. Test: cycle case.
- Bug mode 3: no seen set at all → same as mode 2.

Also note: `seen` is a single Set threaded through the whole tree, created per top-level canonicalize call. Good.

Another branch: `typeof value === 'object'` with `Array.isArray` false → treated as a plain object via Object.keys. What about Date? new Date() is an object; Object.keys(date) → [] → canonicalize(new Date()) === "{}". Silent data loss! Dates are common in clinical reports. JSON.stringify(date) → ISO string, but the normalize path treats it as an empty object. Hmm — is that in scope? The plan says structured JSON content; a Date instance isn't JSON. The code would silently render it as "{}". Should I test that? It's an "error path that looks like success" — but what's the *correct* behavior per spec? The spec doesn't say Dates should throw. The implementation defines the behavior: Date → "{}". Pinning that would be testing an arguably-buggy behavior. I could include it as a documented-behavior case: "non-plain objects (e.g. Date) are serialized via their own enumerable keys (Date → '{}')" — but that pins a footgun. Alternatively, put it in "not testing": not testing non-plain object types (Date, Map, class instances) because the plan defines content as structured JSON (plain objects/arrays/primitives) and pinning Date's rendering would over-specify. I think that's the honest move. Actually wait — Map: Object.keys(new Map()) → [] → "{}". Same. OK, not-testing line.

Hmm, but should canonicalize throw on Date? The task says "structured JSON" content — the controller receives JSON from an HTTP body, which can only contain plain objects/arrays/primitives/null. So Date/Map can't arrive via the API; only programmatic callers. The plan's CanonicalizationError covers "non-serializable input". Date is JSON-serializable (to a string) by JSON.stringify, but not via this normalize. Since the plan doesn't specify, I'll leave it in not-testing with a reason.

Let me also think about: strings containing control characters / newlines — JSON.stringify escapes \n as "\\n". Cross-language: Python also escapes. Fine, no need for a case.

Unicode and UTF-8: JSON.stringify("é") → '"é"' (not escaped). createHash .update(canonical, 'utf8') — explicit utf8. If someone used the default (also utf8) or 'binary'/'latin1', non-ASCII would hash differently. Case: "non-ASCII content hashes as UTF-8 bytes" — what would break: if the digest were computed over a Latin-1/UTF-16 encoding or if Unicode were escaped to \uXXXX before hashing (which changes the byte sequence). This is a real cross-implementation determinism case. Include it.

Now, the "duplicate delivery" awkward category: for hashing, the analog is idempotency — anchoring the same content twice must produce identical hashes (which underpins exactly-one-anchor + verify). I'll frame the determinism case that way: "equal content, different construction (key order, fresh object identity) → identical hash; this is what makes verify and re-derivation stable".

Let me draft the list. Format: `- <name> — <what it proves, and what would have to break for it to fail>`.

Draft cases:

1. `hashContent is deterministic for equal content in different key orders` — proves the core purpose: {a:1,b:2} and {b:2,a:1} (fresh objects) yield the same SHA-256 hex. Would fail if keys were hashed in insertion order, if object identity/prototype leaked into the digest, or if any non-determinism (timestamps, memory addresses) entered the canonical form.

2. `different content yields different hashes` — proves the digest actually covers the content: {a:1} vs {a:2} (and a value change inside a nested field) hash differently. Would fail if the hash were computed over a constant, over only a subset of fields, or if canonicalization dropped data.

3. `object keys are sorted at every nesting level, not just the top` — proves canonicalize({b:{d:1,c:2},a:3}) === '{"a":3,"b":{"c":2,"d":1}}'. Would fail if sorting were shallow (top-level only), leaving nested order dependent on insertion order.

4. `array element order is preserved` — proves canonicalize([2,1]) !== canonicalize([1,2]) and hashes differ. Would fail if arrays were "canonicalized" by sorting (a common over-canonicalization that destroys order-dependent clinical data like ordered measurements).

5. `object keys are sorted inside array elements too` — proves canonicalize([{b:1,a:2}]) === '[{"a":2,"b":1}]'. Would fail if normalization were skipped for array items or only applied to top-level objects.

6. `the canonical form has no whitespace` — proves the output is compact (e.g. '{"a":1,"b":2}' with no spaces). Would fail if a pretty-printer or JSON.stringify with an indent argument were used, changing every hash.

7. `hashContent returns a 64-character lowercase hex SHA-256 digest` — pins the digest contract auditors compare against. Would fail on uppercase hex, a different algorithm (MD5's 32 chars), or base64 output.

8. `non-ASCII content is hashed as UTF-8 bytes` — proves hashContent("héllo") equals the SHA-256 of the canonical string's UTF-8 encoding. Would fail if the digest were computed over Latin-1/UTF-16, or if Unicode were escaped to \uXXXX before hashing — either would desync from any other language's verifier.

9. `string values are not altered (whitespace and case are significant)` — proves canonicalize("a b") !== canonicalize("a  b") and "True" !== "true". Would fail if the canonicalizer trimmed, collapsed whitespace, or case-folded string values (over-canonicalization that changes meaning).

10. `top-level primitives and null serialize as JSON literals` — proves canonicalize(42)==="42", canonicalize("x")==='"x"', canonicalize(null)==="null". Would fail if the code assumed an object root (e.g. Object.keys on a primitive yielding "{}" for every scalar).

11. `empty object and empty array render as {} and []` — boundary values: canonicalize({})==="'{}'", canonicalize([])==="'[]'". Would fail if empty containers were dropped, nulled, or treated as errors.

12. `number formatting follows JSON.stringify semantics (boundary: 1e21 → "1e+21")` — proves large numbers use exponential notation and we delegate to JSON rather than hand-rolling. Would fail if a custom number formatter produced "1000000000000000000000" or dropped exponent form. Hmm, is this worth it? It's a boundary value the rules ask for. I'll keep it but maybe merge with -0? "1e21 → '1e+21' and -0 → '0'" — both pin JSON.stringify delegation. One line: `numbers are formatted by JSON semantics, not hand-rolled (1e21 → "1e+21", -0 → "0")`. Would fail if a custom formatter changed exponent form or emitted "-0". OK.

13. `non-finite numbers throw CanonicalizationError instead of serializing as null` — proves canonicalize(NaN)/Infinity/-Infinity reject. This is the error path that looks like success: without the guard, JSON.stringify(NaN) === "null", so NaN would hash identically to null — a silent, undetectable integrity bug. Would fail if the finite check were removed.

14. `undefined members are rejected, not silently dropped` — proves canonicalize({a:1, b:undefined}) throws. Would fail (i.e. the bug would be) if JSON.stringify's silent key omission were allowed: hash({a:1,b:undefined}) would equal hash({a:1}), making a missing field indistinguishable from an absent one. Also top-level undefined: JSON.stringify(undefined) === undefined, violating the string return. I'll mention both.

15. `function and symbol members are rejected, not silently dropped` — proves canonicalize({f:()=>{}, s:Symbol()}) throws. Same silent-omission danger as undefined; would fail if the guards were removed and JSON.stringify's omission let a payload with an extra handler hash the same as one without.

16. `BigInt throws CanonicalizationError (the wrapped type, not a raw TypeError)` — proves the error contract: instanceof CanonicalizationError. Would fail if the guard/catch were removed and the native TypeError from JSON.stringify leaked — the service maps CanonicalizationError to a 400; a raw TypeError becomes a 500.

17. `circular references throw CanonicalizationError` — proves a direct self-reference (a.self=a) and an indirect cycle (a.b=c, c.a=a) reject cleanly. Would fail if cycle detection were missing (infinite recursion → RangeError stack overflow instead of a clean error) or if the seen set were removed from tracking too early.

18. `shared (non-circular) references are serialized twice, not treated as cycles` — proves DAG: x={v:1}; canonicalize({a:x,b:x}) === '{"a":{"v":1},"b":{"v":1}}'. Would fail if the seen set were never cleared after a subtree completes (false-positive cycle → DAGs rejected) or if repeated references were deduplicated/dropped.

19. `rejection is always CanonicalizationError with a useful message` — hmm, maybe merge into 16. Or: `hashContent propagates CanonicalizationError` — proves the hash layer doesn't swallow or rewrap into a generic Error. Would fail if hashContent caught and rethrew as a plain Error, breaking the service's instanceof-based mapping. Worth one line? The plan lists CanonicalizationError as raised by both canonicalize and hashContent. I'll add a short case: `hashContent rejects with CanonicalizationError (not a bare Error) for non-serializable input` — would fail if the error were rewrapped into a generic Error or string, breaking the instanceof contract the service relies on. OK, include.

20. `purity: repeated calls and later input mutation don't change the result` — proves canonicalize is pure: hash now, mutate the object, the earlier string/hash is unchanged, and a second call on equal content matches. Would fail if the implementation cached by reference, serialized lazily, or mutated/aliased the input. Hmm — is this a real risk? The code rebuilds into a new object and stringifies immediately. A lazy/caching implementation could break this. It's a reasonable property test; the "duplicate delivery" analog: re-anchoring/re-verifying the same content later must reproduce the same hash. I'll include it, framed as: the same content re-submitted later (fresh object, same data) hashes identically — underpins verify. Actually that's case 1. The mutation part is separate. I'll keep it concise: `canonicalize does not depend on object identity or later mutation` — two distinct object instances with equal data hash the same; mutating the input after hashing doesn't retroactively change anything. Would fail if identity (e.g. a WeakMap cache keyed by object, or including a reference count) leaked into the digest.

That's about 19 cases. Maybe I should trim to keep it tight, but the rules ask for one case per branch; this is a small module and these are all real branches. Let me count the branches in the code:

- null → covered (10)
- string → (8, 9)
- boolean → (10)
- number finite → (12)
- number non-finite → (13)
- bigint → (16)
- function → (15)
- symbol → (15)
- undefined → (14)
- array → (4, 5)
- object sort → (2/3, 6)
- cycle → (17)
- DAG → (18)
- hash format → (7)
- utf8 → (8)

Plus determinism/inequality (1, 2), purity (20), hashContent error propagation (19).

Good coverage. Now the closing "not testing" line: one line naming what I deliberately am not testing and why. Candidates:
- Concurrency/async: pure synchronous function, no shared state — nothing to race.
- Depth limits / huge payloads: no bound defined in the plan; pinning stack-overflow behavior would over-specify.
- Non-plain object types (Date, Map, class instances): the plan defines content as structured JSON arriving as plain data; pinning their rendering (Date → "{}") would over-specify an edge the API can't even deliver.
- Collision resistance / cryptographic strength: that's SHA-256's property, not this code's.
- Cross-language vector tests against a reference implementation: out of scope for this spec file (could be a fixture suite).

The rules say "one closing line" — one line. I need to pick the most important, or compress into one line. "Name what you deliberately are not testing and why, in one closing line." I can write one line covering the main exclusions compactly. Let me do: "Not testing: concurrency/async interleaving (canonicalize/hashContent are pure, synchronous, and stateless — no shared state to race), depth limits or payload-size exhaustion (the plan defines no bound, so pinning stack-overflow behavior would over-specify), non-plain object types like Date/Map (the plan scopes content to structured JSON of plain data, and the HTTP boundary can't deliver a Date), and SHA-256 collision resistance (a property of the algorithm, not of this code)."

That's one line (long, but one line). Good.

Wait — the rules also say "include awkward cases: concurrency, duplicate delivery, exhaustion, boundary values, error paths that look like success." I should make sure the list visibly addresses these where applicable:
- Concurrency → not applicable, named in closing line with reason. ✓
- Duplicate delivery → analog: re-submission of the same content must hash identically (cases 1/20). I'll make case 1 or 20 explicitly say "re-submitted (duplicate) content hashes identically". ✓
- Exhaustion → depth/size not pinned, named in closing line; but I do have boundary values (12: number formatting; 11: empty containers). Should I add an exhaustion-flavored case that IS defined? There's no defined behavior for deep input. So closing line handles it. ✓
- Boundary values → 10, 11, 12. ✓
- Error path that looks like success → 13 (NaN→"null"), 14/15 (silent drop). ✓

Now the format check: one line per case, `- <name> — <what it proves, and what would have to break for it to fail>`. Em dash separator. Name should read like a test name (e.g. "hashContent is deterministic across key order"). I'll use imperative/declarative names.

Also: "reply with the list and nothing else." So no preamble, no headings? The shape shows only the lines. I'll output just the bullet lines and the closing line. The closing line — should it also be a bullet? "In one closing line" — I'll make it a final bullet starting with "Deliberately not testing:" for consistency. That keeps the whole reply a uniform list.

Let me also double-check a few implementation details so my "would have to break" clauses are accurate:

- canonicalize(42): normalize(42) → number, finite → 42; JSON.stringify(42) → "42". ✓
- canonicalize("x") → '"x"'. ✓
- canonicalize(null) → "null". ✓
- canonicalize({}) → "{}". ✓
- canonicalize([]) → "[]". ✓
- canonicalize([2,1]) → "[2,1]"; [1,2] → "[1,2]". ✓
- canonicalize({b:{d:1,c:2},a:3}) → keys sorted: a, b; inner c, d → '{"a":3,"b":{"c":2,"d":1}}'. ✓
- canonicalize([{b:1,a:2}]) → '[{"a":2,"b":1}]'. ✓
- NaN → throws 'Non-finite numbers...'. ✓ And JSON.stringify(NaN) is indeed "null". ✓
- Infinity → throws. ✓
- BigInt(1) → throws 'BigInt values...'. Without the guard, JSON.stringify(1n) throws TypeError "Do not know how to serialize a BigInt". ✓
- Top-level function: normalize throws 'Functions...'. Without guard, JSON.stringify(fn) → undefined (not a string!) — canonicalize would return undefined. ✓ My clause: "silently dropped / returns undefined".
- {a:1, f:()=>{}} without guard → JSON.stringify drops f → '{"a":1}' — silent loss. ✓
- Symbol: top-level JSON.stringify(Symbol()) → undefined; as a value {s:Symbol()} → dropped. Symbol as key is ignored by JSON.stringify. ✓
- undefined: top-level → undefined; {b:undefined} → dropped. ✓
- Cycle a.self=a: normalize adds a to seen, processes self → seen.has → throws. ✓ Without detection: infinite recursion → RangeError. ✓
- DAG {a:x,b:x}: process x for a (add, children, remove), then b: not in seen → serialize again. ✓ If never removed: second time throws 'Circular structure' — false positive. ✓
- UTF-8: createHash('sha256').update(canonical, 'utf8'). If 'latin1' were used, "héllo" bytes differ → different digest. ✓ Also if Unicode were escaped (JSON.stringify doesn't escape é by default), the byte sequence changes. ✓
- 1e21 → JSON.stringify(1e21) === "1e+21". ✓ -0 → "0". ✓
- 64 lowercase hex: digest('hex') is lowercase, sha256 → 32 bytes → 64 chars. ✓

One more possible case: `canonicalize` output is a string (return-type contract) — covered implicitly.

Should I include a case that the error message is developer-facing English? The envelope rules are about HTTP errors; CanonicalizationError's message is internal. Skip.

Also, should I test that hashContent and canonicalize agree (hash = sha256 of canonicalize output)? That's an implementation detail; the UTF-8 case partially pins it. I could add: `hashContent is exactly SHA-256 of the canonicalize output` — proves the two functions compose: hashContent(v) === sha256hex(canonicalize(v)). Would fail if the hash were computed over a different (e.g. pre-normalization) serialization. This is actually a valuable independent check: it proves the hash covers precisely the canonical form, nothing more/less. I'll include it — it's the contract verify() depends on (verify recomputes the hash; if anchor and verify used different serialization, they'd mismatch). Good case.

Final list order — group logically:
1. Determinism / key-order invariance (core)
2. Different content → different hash
3. Sorted at every level
4. Arrays preserve order
5. Sort inside array elements
6. No whitespace
7. Hash = SHA-256 of canonicalize output (composition contract)
8. 64-char lowercase hex
9. UTF-8 for non-ASCII
10. String values not altered
11. Top-level primitives/null
12. Empty containers
13. Number formatting boundary (1e+21, -0)
14. Non-finite → throw (looks like success: NaN→"null")
15. undefined rejected (silent drop)
16. function/symbol rejected (silent drop)
17. BigInt → CanonicalizationError not TypeError
18. Circular → throw
19. DAG shared reference → serialized twice
20. Purity / duplicate submission identical; identity/mutation independence
21. hashContent propagates CanonicalizationError type

21 lines + closing. A bit long, but each is a distinct branch/property. Could I merge 15 and 16? Both are "JSON.stringify's silent omission must become an error" but the branches are separate typeof cases ('undefined' vs 'function'/'symbol') and each could be wrong on its own (e.g. someone guards undefined but not function). The rules say one case per branch that could be wrong on its own → keep separate. Could I merge 11 and 12? Top-level primitive vs empty container are different branches (typeof switch vs object case). Keep separate.

Merge 17 into 16/18? BigInt is its own typeof branch; the "wrapped error type" angle is distinct from cycle. Keep.

Merge 21 into the others? The instanceof contract at the hashContent level is distinct from canonicalize throwing. Keep, short.

Let me also reconsider case 12 (number formatting). Is pinning "-0 → '0'" wise? It pins a JS quirk. If the team later "fixes" -0 to emit "-0", the test fails — is that a good failure? It documents that we follow JSON.stringify semantics, which is what cross-language JS-based verifiers would do... but Python would emit -0.0. Honestly, the safer pin is just "we delegate to JSON.stringify for number formatting" with 1e21 as the example. I'll phrase it: `number formatting is delegated to JSON semantics (1e21 → "1e+21", -0 → "0")` — what would have to break: a hand-rolled formatter. That's fine; it pins delegation, which is the implementation choice.

Now let me write the final lines with the exact em-dash format. Keep each line reasonably concise but complete: "what it proves, and what would have to break for it to fail".

Let me write them out:

- `hashContent is invariant to object key order` — proves the core anchoring contract: two fresh objects with identical data but different insertion orders ({a:1,b:2} vs {b:2,a:1}) produce the same digest, so a re-submitted (duplicate) version of the same content always re-hashes to the anchored value. Would fail if keys were serialized in insertion order, if object identity leaked into the digest, or if any non-determinism (timestamps, addresses) entered the canonical form.

- `different content produces different hashes` — proves the digest actually covers the content: {a:1} vs {a:2}, and a changed value buried in a nested field, hash differently. Would fail if the hash were computed over a constant, over only top-level fields, or if canonicalization silently dropped data.

- `object keys are sorted lexicographically at every nesting level` — proves canonicalize({b:{d:1,c:2},a:3}) is exactly '{"a":3,"b":{"c":2,"d":1}}'. Would fail if sorting were shallow (top level only), leaving nested order dependent on insertion order.

- `array element order is preserved` — proves [2,1] and [1,2] canonicalize (and hash) differently. Would fail if arrays were "canonicalized" by sorting — an over-canonicalization that destroys order-dependent data (e.g. ordered measurements) and makes distinct contents collide.

- `object keys are sorted inside array elements too` — proves canonicalize([{b:1,a:2}]) is '[{"a":2,"b":1}]'. Would fail if normalization were skipped for array items or applied only to the top-level object.

- `the canonical form is compact, with no whitespace` — proves the output contains no spaces or newlines (e.g. '{"a":1,"b":2}'). Would fail if a pretty-printer or an indented JSON.stringify were used, which would change every hash and break existing anchors.

- `hashContent is exactly the SHA-256 of the canonicalize output` — proves the two functions compose: hashContent(v) equals the SHA-256 hex of canonicalize(v), so verify() recomputing from content lands on the anchored hash. Would fail if the digest were computed over a different serialization (raw input, pre-normalization, or with extra fields).

- `the digest is 64 lowercase hex characters` — pins the SHA-256 hex contract auditors compare against. Would fail on uppercase hex, base64 output, or a different algorithm (e.g. MD5's 32 chars).

- `non-ASCII content is hashed as UTF-8 bytes` — proves hashContent("héllo") equals the SHA-256 of the canonical string encoded as UTF-8. Would fail if the digest used Latin-1/UTF-16, or if Unicode were escaped to \uXXXX before hashing — either would desync from a verifier implemented in another language.

- `string values are never altered` — proves canonicalize("a b") ≠ canonicalize("a  b") and "True" ≠ "true": whitespace and case inside strings are significant. Would fail if the canonicalizer trimmed, collapsed whitespace, or case-folded values — over-canonicalization that changes meaning.

- `top-level primitives and null serialize as JSON literals` — proves canonicalize(42)==="42", canonicalize("x")==='"x"', canonicalize(true)==="true", canonicalize(null)==="null". Would fail if the code assumed an object root (e.g. Object.keys on a scalar yielding "{}" for every primitive).

- `empty object and empty array render as {} and []` — boundary values: canonicalize({})==="'{}'", canonicalize([])==="'[]'". Would fail if empty containers were dropped, nulled, or rejected.

- `number formatting follows JSON semantics (1e21 → "1e+21", -0 → "0")` — proves numbers are delegated to JSON.stringify rather than hand-rolled. Would fail if a custom formatter emitted full decimal expansion or "-0", desyncing from any JSON-based verifier.

- `non-finite numbers throw instead of serializing as null` — proves canonicalize(NaN), Infinity, and -Infinity reject with CanonicalizationError. This is the error path that looks like success: without the guard, JSON.stringify(NaN) === "null", so NaN would hash identically to a real null — a silent, undetectable integrity bug. Would fail if the Number.isFinite check were removed.

- `undefined members are rejected, not silently dropped` — proves canonicalize({a:1,b:undefined}) and top-level undefined throw. Would fail (i.e. the bug would be) if JSON.stringify's silent omission were allowed: hash({a:1,b:undefined}) would equal hash({a:1}), making a present-but-undefined field indistinguishable from an absent one.

- `function and symbol members are rejected, not silently dropped` — proves canonicalize({f:()=>1}) and {s:Symbol()} throw. Same silent-omission danger: without the guards, a payload carrying an extra handler or symbol would hash identically to one without it.

- `BigInt throws CanonicalizationError, not a raw TypeError` — proves the error-type contract: the rejection is instanceof CanonicalizationError. Would fail if the guard or the catch-rewrap were removed and JSON.stringify's native TypeError leaked — the service maps CanonicalizationError to a 400; a raw TypeError becomes an unhandled 500.

- `circular references throw CanonicalizationError` — proves both a direct self-reference (a.self=a) and an indirect cycle (a.b=c, c.a=a) reject cleanly. Would fail if cycle detection were missing or the in-progress set were cleared too early: the recursion would run to a RangeError stack overflow instead of a clean, typed error.

- `shared non-circular references are serialized twice, not flagged as cycles` — proves DAGs work: with x={v:1}, canonicalize({a:x,b:x}) === '{"a":{"v":1},"b":{"v":1}}'. Would fail if the seen set were never cleared after a subtree completes (false-positive cycle rejecting legitimate shared structure) or if repeated references were deduplicated away.

- `hashing is pure: object identity and later mutation don't matter` — proves two distinct instances with equal data hash the same, and mutating the input after hashing doesn't retroactively change the stored canonical string or digest. Would fail if a cache keyed by object identity, or any reference to the input, leaked into the result.

- `hashContent rejects with CanonicalizationError (not a bare Error)` — proves the hash layer propagates the typed error rather than swallowing or rewrapping it. Would fail if hashContent caught and rethrew a generic Error or string, breaking the instanceof-based mapping the service relies on.

Closing line:
- Deliberately not testing: concurrency/async interleaving (canonicalize/hashContent are pure, synchronous, and stateless — nothing to race), depth or payload-size exhaustion (the plan defines no bound, so pinning stack-overflow behavior would over-specify), non-plain object types such as Date/Map (the plan scopes content to structured JSON of plain data, which the HTTP boundary can't deliver anyway), and SHA-256 collision resistance (a property of the algorithm, not of this code).

That's 21 cases + 1 closing = 22 lines. I think that's thorough and each has a named failure condition.

One more check on the rules: "cover behavior the task statement asks to be tested" — the task says "define canonicalization" and the hash must let auditors verify years later → determinism, key-order invariance, UTF-8 cross-language. ✓ "Behavior the plan says matters" — the plan's test section: determinism, order-independence, error on non-serializable (circular). ✓ All covered.

"Reply with the list and nothing else." — no intro/outro. Just the lines.
```

## reply

- `hashContent is invariant to object key order` — proves the core anchoring contract: two fresh objects with identical data but different insertion orders ({a:1,b:2} vs {b:2,a:1}) produce the same digest, so a re-submitted (duplicate) copy of the same content always re-hashes to the anchored value. Fails if keys are serialized in insertion order, if object identity leaks into the digest, or if any nondeterminism (timestamp, address) enters the canonical form.
- `different content produces different hashes` — proves the digest actually covers the content: {a:1} vs {a:2}, and a changed value buried in a nested field, hash differently. Fails if the hash is computed over a constant, over only top-level fields, or if canonicalization silently drops data.
- `object keys are sorted lexicographically at every nesting level` — proves canonicalize({b:{d:1,c:2},a:3}) is exactly '{"a":3,"b":{"c":2,"d":1}}'. Fails if sorting is shallow (top level only), leaving nested order dependent on insertion order.
- `array element order is preserved` — proves [2,1] and [1,2] canonicalize (and hash) differently. Fails if arrays are "canonicalized" by sorting — an over-canonicalization that destroys order-dependent data (e.g. ordered measurements) and makes distinct contents collide.
- `object keys are sorted inside array elements too` — proves canonicalize([{b:1,a:2}]) is '[{"a":2,"b":1}]'. Fails if normalization is skipped for array items or applied only to the top-level object.
- `the canonical form is compact, with no whitespace` — proves the output contains no spaces or newlines (e.g. '{"a":1,"b":2}'). Fails if a pretty-printer or indented JSON.stringify is used, which changes every hash and breaks already-anchored content.
- `hashContent is exactly the SHA-256 of the canonicalize output` — proves the two functions compose: hashContent(v) equals the SHA-256 hex of canonicalize(v), so verify() recomputing from content lands on the anchored hash. Fails if the digest is computed over a different serialization (raw input, pre-normalization, or with extra fields).
- `the digest is 64 lowercase hex characters` — pins the SHA-256-hex contract auditors compare against. Fails on uppercase hex, base64 output, or a different algorithm (e.g. MD5's 32 chars).
- `non-ASCII content is hashed as UTF-8 bytes` — proves hashContent("héllo") equals the SHA-256 of the canonical string encoded as UTF-8. Fails if the digest uses Latin-1/UTF-16, or if Unicode is escaped to \uXXXX before hashing — either desyncs from a verifier implemented in another language.
- `string values are never altered` — proves canonicalize("a b") ≠ canonicalize("a  b") and "True" ≠ "true": whitespace and case inside strings are significant. Fails if the canonicalizer trims, collapses whitespace, or case-folds values — over-canonicalization that changes meaning.
- `top-level primitives and null serialize as JSON literals` — proves canonicalize(42)==="42", canonicalize("x")==='"x"', canonicalize(true)==="true", canonicalize(null)==="null". Fails if the code assumes an object root (e.g. Object.keys on a scalar yielding "{}" for every primitive).
- `empty object and empty array render as {} and []` — boundary values: canonicalize({})==="'{}'", canonicalize([])==="'[]'". Fails if empty containers are dropped, nulled, or rejected.
- `number formatting follows JSON semantics (1e21 → "1e+21", -0 → "0")` — proves numbers are delegated to JSON.stringify rather than hand-rolled. Fails if a custom formatter emits full decimal expansion or "-0", desyncing from any JSON-based verifier.
- `non-finite numbers throw instead of serializing as null` — proves canonicalize(NaN), Infinity, and -Infinity reject with CanonicalizationError. This is the error path that looks like success: without the guard, JSON.stringify(NaN) === "null", so NaN would hash identically to a real null — silent, undetectable corruption. Fails if the Number.isFinite check is removed.
- `undefined members are rejected, not silently dropped` — proves canonicalize({a:1,b:undefined}) and top-level undefined throw. Fails if JSON.stringify's silent omission is allowed: hash({a:1,b:undefined}) would equal hash({a:1}), making a present-but-undefined field indistinguishable from an absent one.
- `function and symbol members are rejected, not silently dropped` — proves canonicalize({f:()=>1}) and {s:Symbol()} throw. Same silent-omission danger: without the guards, a payload carrying an extra handler or symbol would hash identically to one without it.
- `BigInt throws CanonicalizationError, not a raw TypeError` — proves the error-type contract: the rejection is instanceof CanonicalizationError. Fails if the guard or the catch-rewrap is removed and JSON.stringify's native TypeError leaks — the service maps CanonicalizationError to a 400; a raw TypeError becomes an unhandled 500.
- `circular references throw CanonicalizationError` — proves both a direct self-reference (a.self=a) and an indirect cycle (a.b=c, c.a=a) reject cleanly. Fails if cycle detection is missing or the in-progress set is cleared too early: recursion runs to a RangeError stack overflow instead of a clean, typed error.
- `shared non-circular references are serialized twice, not flagged as cycles` — proves DAGs work: with x={v:1}, canonicalize({a:x,b:x}) === '{"a":{"v":1},"b":{"v":1}}'. Fails if the seen set is never cleared after a subtree completes (false-positive cycle rejecting legitimate shared structure) or if repeated references are deduplicated away.
- `hashing is pure: object identity and later mutation don't matter` — proves two distinct instances with equal data hash the same, and mutating the input after hashing doesn't retroactively change the stored canonical string or digest. Fails if a cache keyed by object identity, or any live reference to the input, leaks into the result.
- `hashContent rejects with CanonicalizationError (not a bare Error)` — proves the hash layer propagates the typed error rather than swallowing or rewrapping it. Fails if hashContent catches and rethrows a generic Error or string, breaking the instanceof-based mapping the service relies on.
- Deliberately not testing: concurrency/async interleaving (canonicalize/hashContent are pure, synchronous, and stateless — nothing to race), depth or payload-size exhaustion (the plan defines no bound, so pinning stack-overflow behavior would over-specify), non-plain object types such as Date/Map (the plan scopes content to structured JSON of plain data, which the HTTP boundary can't deliver anyway), and SHA-256 collision resistance (a property of the algorithm, not of this code).

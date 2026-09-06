# 07-auth.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/auth.spec.ts` based on the PLAN.md and the implementation files provided. I need to:

1. Cover behaviour the task statement asks to be tested
2. Cover behaviour the plan says matters
3. One case per branch that could be wrong on its own
4. Say what would have to break for each test to fail
5. Include awkward cases: concurrency, duplicate delivery, exhaustion, boundary values, error path that looks like success path
6. Name what I'm deliberately NOT testing and why, in one closing line

Let me look at what the task asks to be tested:
- Concurrent presentation of one token
- A replay that invalidates a sibling token
- Rotation against the absolute deadline
- The rejection responses compared to each other

And from the plan (Section 5), six test cases are planned:
1. Concurrent rotation: two refresh calls with the same token — exactly one returns 200, the other 401
2. Replay after rotation: rotate token A→B, then present A again — B is also invalidated
3. Absolute deadline: sign-in with expiresAt = now+1h; after 70 min, a freshly rotated token is rejected
4. Rejection indistinguishability: malformed, unknown, expired, and reuse all return identical status + body
5. Audit completeness: each of the four rejection classes writes a distinct event_type to audit_events
6. Source precedence: body refreshToken and cookie refresh_token both present — body token is used

Now let me think about what branches could be wrong on their own, and what would have to break:

Looking at the repository code:
- `executeRefresh` branches: unknown (rows.length === 0), retired (reuse), expired, active→rotate
- `retireAndCreate`: retire first, then create new
- `invalidateFamily`: updateMany where retiredAt is null

Looking at the service:
- Malformed guard (length !== 64 or pattern fails)
- After repo call: rotated → issue access token + generate new raw token; rejected/reuse → throw

Looking at the controller:
- Body wins over cookie
- Cookie parsing
- Error → 401 with specific envelope

Let me think about what could break:

1. **Concurrent rotation** — two simultaneous calls with same valid token. One must get 200, other must get 401 (reuse). Would fail if: FOR UPDATE lock is missing, or if the second caller doesn't re-read and see retired_at set.

2. **Replay invalidates sibling** — rotate A→B, then present A. B must be invalidated. Would fail if: invalidateFamily doesn't actually update sibling rows, or if the retired check happens after expired (so an expired+retired token skips the reuse path).

3. **Absolute deadline not extended by rotation** — create token with expiresAt = now+1h, rotate it (getting new token B), then verify B has the same expiresAt as A. Then advance past deadline, present B → rejected. Would fail if: retireAndCreate uses `new Date()` instead of `row.expires_at` for the new token, or if the expired check is `<=` vs `<` wrong.

4. **Rejection indistinguishability** — malformed, unknown, expired, reuse all produce identical HTTP 401 + body. Would fail if: any path returns a different status code (e.g., 400 for malformed), different error code, different message, or different details object.

5. **Audit completeness** — each rejection class writes distinct event_type. Would fail if: audit recording is missing for one branch, or if two branches write the same event_type.

6. **Source precedence: body wins** — both body and cookie present, body token is used. Would fail if: controller checks cookie first, or if `bodyToken ?? cookieValue` is reversed.

Now let me think about additional branches that could be wrong on their own:

7. **Malformed token (wrong length)** — e.g., 63 chars or 65 chars. Should be rejected as invalid without hitting DB. Would fail if: the length check is off-by-one, or if a 63-char token passes through to hash and DB lookup (returning unknown instead of malformed — but wait, both return same 401, so the only way to detect is via audit or by verifying no DB query was made).

8. **Malformed token (wrong charset)** — e.g., 64 chars but contains 'g'. Same as above.

9. **Empty/missing token** — no body, no cookie. Should be malformed. Would fail if: controller passes undefined and service crashes, or if it's treated as unknown instead of malformed.

10. **Cookie parsing: token in cookie only** — no body, valid token in cookie. Should work. Would fail if: parseCookieValue is broken (e.g., doesn't trim, or fails on multiple cookies).

11. **Cookie parsing: multiple cookies** — `a=1; refresh_token=<valid>; b=2`. Should extract the right one. Would fail if: parser matches wrong cookie or fails on semicolons within values (though hex tokens won't have semicolons).

12. **Rotate succeeds: correct response shape** — 200 with both accessToken and refreshToken present, refreshToken is a valid 64-hex string. Would fail if: service forgets to generate new raw token, or returns the old token.

13. **New token is different from presented token** — after rotation, the returned refreshToken must differ from the input. Would fail if: retireAndCreate reuses the same hash (which can't happen with randomBytes, but if someone hardcoded it).

14. **New token is valid for a subsequent rotation** — rotate A→B, then present B. Should succeed (if within deadline). Would fail if: the new token's hash isn't stored correctly, or family_id is wrong.

15. **Retired check before expired** — a token that is BOTH retired AND expired. Should trigger reuse (compromise), not expired. Would fail if: the code checks expired first, so a retired+expired token gets REJECTED_EXPIRED instead of REUSE_COMPROMISE, and the family isn't invalidated.

16. **Concurrent: exactly one rotates (not zero, not two)** — the 200 response must contain a valid new token. Would fail if: the lock is advisory (doesn't actually block), or if both callers think they won.

Let me also think about the boundary: expires_at === now(). The code uses `row.expires_at < new Date()`. So at the exact instant, it's NOT expired. That's a boundary.

Let me also consider: what about the `details` field in the error envelope? The plan says it must always be `{}`. If any path sets details to something non-empty, that would be distinguishable.

Now let me structure this as a clean list. I'll aim for cases that are each independently falsifiable:

Let me refine my list to be focused and each case names exactly what would break:

1. Concurrent rotation (single winner)
2. Replay of retired token invalidates sibling
3. Retired+expired triggers reuse, not expired (ordering)
4. Absolute deadline preserved across rotation
5. Token past deadline rejected even if freshly rotated
6. Rejection responses are byte-identical (status, code, message, details)
7. Audit events distinguish all four rejection classes
8. Malformed (length) short-circuits without DB access
9. Malformed (charset) rejected
10. Missing token (no body, no cookie) treated as malformed
11. Body wins over cookie when both present
12. Cookie-only path works (valid token in cookie, no body)
13. Successful rotation returns new distinct refreshToken and valid accessToken
14. Newly-rotated token can itself be rotated (chain works)

That's 14 cases. Let me check if I'm missing anything from the task:
- Task says "Tests for: concurrent presentation of one token, a replay that invalidates a sibling token, rotation against the absolute deadline, and the rejection responses compared to each other" — covered by 1, 2, 4/5, 6
- Plan adds: audit completeness (7), source precedence (11)

What about "the error path that looks like the success path"? The reuse path returns 401 (same as all rejections) but internally it does a family invalidation. The test that proves this is #2 (sibling gets invalidated). But there's a subtler case: what if the reuse path accidentally returns 200? That would be caught by #6 (indistinguishability) — if reuse returned 200, it wouldn't match the other 401s.

What about "exhaustion"? I don't think there's a natural exhaustion case here unless we're talking about family invalidation exhausting all tokens. Maybe: after family invalidation, presenting ANY token from that family (including the "current" one) results in 401. That's partially covered by #2 but let me make it explicit.

What about the boundary where expires_at is exactly now? The code uses `<`, so at the exact millisecond it's still valid. This is a boundary case but hard to test deterministically without mocking Date. I'll mention it as part of #4/5.

Let me finalize. I'll keep it to cases where I can name exactly what breaks:
```

## reply

- **Concurrent rotation yields exactly one success** — two `Promise.all` calls with the same valid token; one resolves with 200 + a new refreshToken, the other rejects with 401. Fails if the `FOR UPDATE` row lock is absent or non-blocking, so both callers read `retired_at = null` and both rotate (two active tokens in the same family), or if the lock is a deadlock that causes both to fail (zero successes).

- **Replay of a retired token invalidates its sibling** — rotate A → B (both in family F), then present A again; the response is 401 and a subsequent presentation of B also returns 401. Fails if `invalidateFamily` does not set `retiredAt` on still-active rows in the family (e.g. wrong `WHERE` clause, missing `retiredAt: null` filter), or if the reuse branch is skipped entirely so B remains usable.

- **Retired-and-expired triggers reuse, not expired** — a token that is both `retired_at IS NOT NULL` and `expires_at < now()` produces a `REUSE_COMPROMISE` audit and family invalidation, not a `REJECTED_EXPIRED` audit. Fails if the expired check is ordered before the retired check in `executeRefresh`, causing the compromise signal to be lost and the family left partially active.

- **Rotation preserves the absolute deadline** — create a token with `expiresAt = T`; rotate it to get token B; assert B's stored `expiresAt === T`. Fails if `retireAndCreate` uses `new Date()` or an "expires at now + 1h" default instead of forwarding `row.expires_at` to the new row.

- **A freshly rotated token is rejected once past the family deadline** — advance the clock (or seed `expiresAt` in the past) so that a just-rotated token B is now expired; presenting B returns 401 and the audit is `REJECTED_EXPIRED`, not `ROTATED`. Fails if the service or repository re-computes a deadline on rotation, or if the expired comparison is `<=` when it should be `<` (or vice-versa), shifting the boundary by one tick.

- **All four rejection classes return byte-identical HTTP responses** — malformed, unknown, expired, and reuse each produce status 401, body `{"error":{"code":"invalid_refresh_token","message":"Refresh token is invalid.","details":{}}}`. Fails if any path returns a different status (e.g. 400 for malformed), a different `code`, a non-empty `details` object, or an extra field, allowing a caller to fingerprint the reason.

- **Audit events carry distinct `event_type` per rejection class** — after one malformed, one unknown, one expired, and one reuse presentation, the `audit_events` table contains exactly one row each of `REJECTED_MALFORMED`, `REJECTED_UNKNOWN`, `REJECTED_EXPIRED`, and `REUSE_COMPROMISE` (plus `ROTATED` rows for successful rotations). Fails if a branch omits the audit insert, two branches write the same enum value, or the `family_id`/`token_id` columns are wrong (making the audit row unattributable).

- **Malformed token (wrong length) short-circuits before any database access** — a 63-character or 65-character hex string returns 401 with no `SELECT` or `INSERT` hitting the database. Fails if the length guard is missing, off-by-one, or placed after the hash computation and DB call, causing a spurious `REJECTED_UNKNOWN` audit row for input that never existed in the table.

- **Malformed token (wrong character set) is rejected** — a 64-character string containing a non-hex character (e.g. `'g'`) returns 401 via the same envelope; no DB row is created or matched. Fails if the regex pattern is absent or overly permissive (e.g. accepts uppercase, rejects valid lowercase), allowing the token to reach `executeRefresh` and produce an `REJECTED_UNKNOWN` instead of `REJECTED_MALFORMED`.

- **Missing token (no body, no cookie) is treated as malformed** — `POST /auth/refresh` with an empty JSON body and no `Cookie` header returns 401, not 500. Fails if the controller passes `undefined` into the service and the length check throws a `TypeError` on `undefined.length`, or if the empty string is forwarded to the DB as an unknown hash.

- **Body `refreshToken` takes precedence over cookie when both are present** — send a valid token in the body and a *different* (also valid, but distinct) token in the `refresh_token` cookie; the body token is the one that rotates (verify via audit `token_id` or by confirming the cookie token remains valid for a subsequent request). Fails if the controller evaluates `cookieValue ?? bodyToken` (reversed), or if cookie parsing overwrites the body value.

- **Cookie-only path delivers the token correctly** — no body; a valid 64-hex token in `Cookie: refresh_token=<token>` rotates successfully. Fails if `parseCookieValue` does not trim surrounding whitespace, does not handle the token being the first or last segment in a multi-cookie header, or strips a leading/trailing character.

- **Successful rotation returns a new, distinct refresh token** — the 200 body contains `refreshToken` that is a 64-lowercase-hex string and differs from the presented token; a subsequent call with the *new* token succeeds (chain of at least two rotations works). Fails if `retireAndCreate` reuses the same hash (deterministic token), if the service returns the old raw token, or if the new row's `tokenHash` is not persisted so the next lookup returns unknown.

- **Family invalidation exhausts every active token in the chain** — build a chain A → B → C (two successful rotations), then replay A; all of B and C are now unusable (each returns 401 on presentation). Fails if `invalidateFamily` only retires the immediate successor or uses a per-row update instead of `updateMany`, leaving deeper chain members active.

**Not testing:** the correctness of `issueAccessToken` (it is a pre-existing dependency, mocked at the boundary); TLS transport security and rate-limiting (out of scope for this module); Prisma query-plan performance under load (the `FOR UPDATE` lock is a correctness mechanism, not a throughput guarantee); and cookie `HttpOnly`/`Secure`/`SameSite` attributes (set by the HTTP layer above this controller).

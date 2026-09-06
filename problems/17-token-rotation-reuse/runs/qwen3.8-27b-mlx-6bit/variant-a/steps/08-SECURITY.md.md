# 08-SECURITY.md

## reasoning

```
The user wants me to write exactly one file: `SECURITY.md`, based on the plan specification. The plan says it should be 15-25 lines stating the ordering between checks and why it is that way round.

Let me look at what the plan specifies for this file:

From the manifest:
```
SECURITY.md | reads: - | Check-ordering rationale (15-25 lines)
```

From section 3, the "Ordering rules between operations" table:

| Pair | Required order | Rationale |
|---|---|---|
| Malformed check vs DB lookup | Malformed first | No hash to compute; short-circuits before any I/O. |
| Retired check vs Expired check (inside `executeRefresh`) | Retired first | A retired+expired token is still a reuse event; compromise detection supersedes expiry. |
| `retireToken` vs `createNewToken` (inside `executeRefresh`) | Retire before create | If create fails, the old token is already dead; no window where two tokens are both active. |
| `invalidateFamily` vs `recordAudit(REUSE_COMPROMISE)` | Invalidate first, audit second (same tx) | If the process crashes mid-tx both roll back; no partial invalidation without audit. |

I need to write this as a SECURITY.md file, 15-25 lines, stating the ordering between checks and why it is that way round. Let me count lines carefully.

Let me draft:

```markdown
# Security — Check Ordering

## Principle

Checks are ordered so that the most security-critical invariant is evaluated first and
so that a failure at any stage never widens the window in which a compromised token
remains valid.

## Ordering

1. **Malformed → unknown.** A token that fails format validation (not 64 hex chars) is
   rejected before any database access. There is no hash to compute and no row to look
   up, so this check short-circuits with zero I/O and prevents an attacker from probing
   the token space through timing or connection-side effects.

2. **Retired → expired (inside the transaction).** When a row is found, the retired
   check precedes the expiry check. A token that is both retired and expired is still a
   reuse event: the attacker already replayed a rotated credential, and that fact must
   be recorded as `REUSE_COMPROMISE` regardless of whether the original deadline has
   passed. Expiry is a liveness concern; compromise is an integrity concern, and
   integrity wins.

3. **Retire → create (rotation).** Within the rotate path the current row is marked
   `retired_at` before the successor row is inserted. If the insert subsequently fails
   (or the process crashes), the old token is already dead. There is no window in which
   two tokens are simultaneously active, which would defeat the single-rotation
   guarantee.

4. **Invalidate → audit (reuse).** Family invalidation and the `REUSE_COMPROMISE`
   audit row are written in the same database transaction, invalidation first. Because
   both are atomic under a single commit, a crash mid-transaction rolls back both:
   there can never be a partial invalidation without its audit trail, nor an audit row
   claiming a compromise that the database does not reflect.

## Indistinguishability

Every rejection path — malformed, unknown, expired, reuse — returns an identical
401 envelope (`code: "invalid_refresh_token"`). The only differentiator is the
`audit_events` row, which lives server-side. This prevents an external caller from
fingerprinting which class of failure occurred and thereby inferring token state.
```

Let me count lines... Let me count more carefully:

1: # Security — Check Ordering
2: (blank)
3: ## Principle
4: (blank)
5: Checks are ordered so that the most security-critical invariant is evaluated first and
6: so that a failure at any stage never widens the window in which a compromised token
7: remains valid.
8: (blank)
9: ## Ordering
10: (blank)
11: 1. **Malformed → unknown.** A token that fails format validation (not 64 hex chars) is
12:    rejected before any database access. There is no hash to compute and no row to look
13:    up, so this check short-circuits with zero I/O and prevents an attacker from probing
14:    the token space through timing or connection-side effects.
15: (blank)
16: 2. **Retired → expired (inside the transaction).** When a row is found, the retired
17:    check precedes the expiry check. A token that is both retired and expired is still a
18:    reuse event: the attacker already replayed a rotated credential, and that fact must
19:    be recorded as `REUSE_COMPROMISE` regardless of whether the original deadline has
20:    passed. Expiry is a liveness concern; compromise is an integrity concern, and
21:    integrity wins.
22: (blank)
23: 3. **Retire → create (rotation).** Within the rotate path the current row is marked
24:    `retired_at` before the successor row is inserted. If the insert subsequently fails
25:    (or the process crashes), the old token is already dead. There is no window in which
26:    two tokens are simultaneously active, which would defeat the single-rotation
27:    guarantee.
28: (blank)
29: 4. **Invalidate → audit (reuse).** Family invalidation and the `REUSE_COMPROMISE`
30:    audit row are written in the same database transaction, invalidation first. Because
31:    both are atomic under a single commit, a crash mid-transaction rolls back both:
32:    there can never be a partial invalidation without its audit trail, nor an audit row
33:    claiming a compromise that the database does not reflect.
34: (blank)
35: ## Indistinguishability
36: (blank)
37: Every rejection path — malformed, unknown, expired, reuse — returns an identical
38: 401 envelope (`code: "invalid_refresh_token"`). The only differentiator is the
39: `audit_events` row, which lives server-side. This prevents an external caller from
40: fingerprinting which class of failure occurred and thereby inferring token state.

That's 40 lines. Too many. I need 15-25 lines. Let me tighten this up significantly.

Let me try again, more concise:

```markdown
# Security — Check Ordering

1. **Malformed before lookup.** Format validation (64 hex chars) precedes any DB access;
   no hash exists to compute, so the check short-circuits with zero I/O.

2. **Retired before expired.** A retired-and-expired token is still a reuse event;
   compromise detection supersedes the liveness check.

3. **Retire before create.** The current row is marked `retired_at` before the successor
   is inserted, so a crash leaves no window where two tokens are simultaneously active.

4. **Invalidate before audit (same tx).** Family invalidation and the `REUSE_COMPROMISE`
   row commit atomically; a crash rolls back both, never leaving a partial state.

## Indistinguishability

All rejections (malformed, unknown, expired, reuse) return an identical 401 envelope.
The only differentiator is the `audit_events` row, which is server-side only.
```

Let me count:
1: # Security — Check Ordering
2: (blank)
3: 1. **Malformed before lookup.** Format validation (64 hex chars) precedes any DB access;
4:    no hash exists to compute, so the check short-circuits with zero I/O.
5: (blank)
6: 2. **Retired before expired.** A retired-and-expired token is still a reuse event;
7:    compromise detection supersedes the liveness check.
8: (blank)
9: 3. **Retire before create.** The current row is marked `retired_at` before the successor
10:    is inserted, so a crash leaves no window where two tokens are simultaneously active.
11: (blank)
12: 4. **Invalidate before audit (same tx).** Family invalidation and the `REUSE_COMPROMISE`
13:    row commit atomically; a crash rolls back both, never leaving a partial state.
14: (blank)
15: ## Indistinguishability
16: (blank)
17: All rejections (malformed, unknown, expired, reuse) return an identical 401 envelope.
18: The only differentiator is the `audit_events` row, which is server-side only.

That's 18 lines. Within 15-25. Good.

Wait, let me re-read the plan more carefully. The plan says "Check-ordering rationale (15-25 lines)". Let me make sure I'm covering all four ordering rules from the plan's table. Yes, I have all four. And the indistinguishability point is from requirement 6 in the variant spec. Good.

Let me also make sure I'm not adding anything the plan doesn't name. The plan says this file is "Check-ordering rationale (15-25 lines)". I'm staying within scope.

Actually, let me reconsider - should I include the "Principle" section? The plan just says "Check-ordering rationale". Let me keep it tight and focused. 18 lines is good.

Let me finalize.
```

## reply

```markdown
# Security — Check Ordering

1. **Malformed before lookup.** Format validation (64 hex chars) precedes any DB access;
   no hash exists to compute, so the check short-circuits with zero I/O.

2. **Retired before expired.** A retired-and-expired token is still a reuse event;
   compromise detection supersedes the liveness check.

3. **Retire before create.** The current row is marked `retired_at` before the successor
   is inserted, so a crash leaves no window where two tokens are simultaneously active.

4. **Invalidate before audit (same tx).** Family invalidation and the `REUSE_COMPROMISE`
   row commit atomically; a crash rolls back both, never leaving a partial state.

## Indistinguishability

All rejections (malformed, unknown, expired, reuse) return an identical 401 envelope.
The only differentiator is the `audit_events` row, which is server-side only.
```

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

# Security — refresh token rotation

`RefreshService.refresh` checks in this order, and no other order is safe:

1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test and
   must not cost a database round trip.
2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored.
3. **Expired** — the deadline is fixed at sign-in; rotation never extends
   it. Checked *before* retired: a stale client presenting a token after
   natural death is not compromise, and wiping a dead family is churn.
4. **Retired (reuse)** — only a rotation retires a token, so a retired token
   in a caller's hand is compromise. Every token descended from the same
   sign-in is retired and `refresh_reuse_detected` is recorded.
5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` alone guarantees
   exactly one rotation under concurrency; earlier checks are advisory. The
   loser takes path 4: a duplicate retry is indistinguishable from a stolen
   replay, so the family — winner's fresh token included — dies.

All four rejections return the same 401, the same envelope (`error.code`
`refresh_token_rejected`, identical message, `details: {}`) and the same
cookie-clearing `Set-Cookie`; only the audit row's `kind` distinguishes
them, so callers cannot fingerprint valid, stale or stolen tokens.

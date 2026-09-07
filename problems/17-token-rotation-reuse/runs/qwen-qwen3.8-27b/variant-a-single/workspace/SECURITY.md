# Refresh-token security

`POST /auth/refresh` checks, in this order; steps 2-5 share one READ
COMMITTED Postgres transaction (row locks arbitrate concurrency).

1. Shape (64-char base64url), else `rejected_malformed` - cheapest check
   first; no token material is ever stored or logged.
2. Lookup by SHA-256 hash; tokens are stored hash-only, so a database
   leak yields no usable tokens. No match: `rejected_unknown`.
3. Expiry against the absolute sign-in deadline. An expired token cannot
   work, so replaying it is not compromise: benign `rejected_expired`,
   no revocation. Expiry must precede the retirement check.
4. Retired = reuse. An already-retired token (or revoked family) was
   presented twice: retire every token descended from the same sign-in,
   mark the family revoked, audit `rejected_reuse`. No race exception -
   a concurrent loser sees the same committed state as a replay.
5. Rotate via `UPDATE ... WHERE id = ? AND retired = false`: exactly one
   concurrent presenter flips the flag, the loser hits step 4, so at
   most one rotation succeeds per token; the successor copies the
   deadline, so rotation never extends the session.

All rejections return one fixed 401 body (`invalid_refresh_token`,
`details: {}`); only the audit table distinguishes them. With both a
body `refreshToken` and a cookie, the body wins: the explicit channel
should not be overridden by an ambient one.

# Security considerations for refresh‑token rotation

1. **Order of checks** – The service validates the presented token **after** it
   has been retrieved from the database but **before** any state mutation.
   The sequence is:
   - Presence of the token.
   - Whether the token is already retired (replay detection).
   - Token expiration.
   - Session revocation status.
   - Session absolute expiration.

   This ordering guarantees that a compromised (already‑retired) token
   immediately triggers session revocation, preventing an attacker from using any
   sibling tokens that were issued before the compromise was observed.

2. **Atomic rotation** – The retirement of the old token and creation of the
   new token are performed in a single database transaction guarded by a
   conditional `UPDATE ... WHERE retiredAt IS NULL`.  This ensures that, under
   concurrent requests, at most one request can succeed in rotating the token.
   All other concurrent requests will observe the token as retired and will be
   treated as a replay, leading to session revocation.

3. **Absolute session deadline** – The `expiresAt` of a session is set once at
   sign‑in and never altered by token rotation.  When a new refresh token is
   issued its expiry is the **minimum** of the configured refresh‑token TTL and
   the session’s absolute deadline, preventing a token from extending the
   session’s lifetime.

4. **Uniform error envelope** – All failure responses are indistinguishable to
   the client (`invalid_refresh_token`).  The server records the precise cause
   (`unknown`, `expired`, `replay_detected`, `session_expired`, etc.) in the
   `TokenAudit` table, enabling forensic analysis without leaking implementation
   details.

5. **Compromise handling** – Upon detection of a replayed (already‑retired)
   token, the whole session is revoked (`revokedAt` is set).  This invalidates
   every refresh token that belongs to the same session, mitigating the impact
   of token theft.

6. **Source of the token** – If both the JSON body field `refreshToken` and the
   `refresh_token` cookie are supplied, the cookie value takes precedence.
   This deterministic rule avoids ambiguity and aligns with the typical
   “cookie‑over‑body” precedence used by browsers.

7. **Audit trail** – Every operation (rotation, replay detection, expiration,
   unknown token) creates a row in `TokenAudit`.  The `event` field records the
   exact reason, while the generic client‑facing error remains constant.

By adhering to this sequence and employing atomic database operations, the
system guarantees **exactly‑once** rotation under concurrency, fast compromise
containment, and a clear, auditable security posture.

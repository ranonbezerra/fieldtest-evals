# Security considerations for refresh‑token rotation

1. **Ordering of checks** – The service first checks for **reuse** (retired token
   or revoked family) *before* checking expiry. A token that is both retired and
   expired is therefore treated as a reuse event, ensuring that a replay attack
   is logged as a compromise rather than a benign expiration.

2. **Atomic retire‑and‑rotate** – The core of the rotation uses a single
   `UPDATE … WHERE retired_at IS NULL AND expires_at > now()` statement. This
   guarantees that, under concurrent requests presenting the same token, only
   one request can successfully retire the token; the other detects that the
   token has already been retired and is handled as a reuse case.

3. **Family‑wide revocation** – When a retired token is presented again, the
   whole token family (all tokens issued from the original sign‑in) is revoked
   in one transactional operation. This prevents an attacker from using any
   sibling token that might still be valid.

4. **Absolute session deadline** – Each token family stores a fixed
   `absolute_expires_at` timestamp set at sign‑in. New refresh tokens are
   issued with an expiry that is the **minimum** of *(now + refresh‑TTL)* and the
   absolute deadline, ensuring that frequent rotations cannot extend a session
   indefinitely.

5. **Uniform error response** – All failure modes (malformed, unknown,
   expired, reuse) result in the same HTTP 401 envelope. This prevents an
   attacker from learning which check failed, while the internal audit table
   records the precise cause for forensic analysis.

6. **Precedence of input sources** – If a client sends the refresh token both
   in the JSON body (`refreshToken`) and as a `refresh_token` cookie, the body
   value takes precedence. This deterministic rule avoids ambiguity and keeps
   the API behaviour predictable.

7. **Audit logging** – Every verification path creates a row in
   `refresh_token_audits` with the presented token (when available), the
   associated family and user identifiers, the event type, and a JSON `details`
   object. This provides a complete, tamper‑evident trail for security
   investigations.

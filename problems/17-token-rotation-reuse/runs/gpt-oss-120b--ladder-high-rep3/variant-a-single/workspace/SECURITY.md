# Security Considerations for Refresh Token Rotation

- **Check token existence first** – if the token is not present in the database we record an `unknown_token` event and reject. This prevents leaking information about valid tokens.

- **Detect reuse before expiry** – a token that has already been retired is treated as a compromise even if it is also expired. By checking `retired_at` prior to `expires_at` we ensure an attacker replaying a stolen token is logged as `reuse_detected`, not merely as an expired token.

- **Retire the presented token atomically** – the rotation uses a conditional `UPDATE … WHERE retired_at IS NULL AND expires_at > now()` inside a transaction. Only one concurrent request can succeed, guaranteeing that exactly one fresh token is issued.

- **Invalidate the entire session family on reuse** – once a retired token is presented again, we set `retired_at` on **all** refresh tokens belonging to the same `session_id` and mark the session as compromised. This cuts off any remaining valid refresh tokens that could have been stolen.

- **Do not extend the absolute deadline** – every new refresh token inherits the original session `expires_at`. The rotation never pushes the session expiration forward, preserving the intended session lifetime.

- **Record an audit entry for every rejection** – the repository writes a `TokenAudit` row with the specific event (`unknown_token`, `reuse_detected`, `expired_token`, `malformed_token`). Auditors can distinguish the root cause while callers see a uniform error envelope.

- **Uniform error response** – the controller always returns a `401` with the envelope `{ "error": { "code": "...", "message": "Invalid refresh token", "details": {} } }`. The `code` is the only differentiator, keeping the API contract stable and avoiding information leakage.

These ordering decisions prioritize early detection of compromise, guarantee a single successful rotation under concurrency, and keep the observable behavior identical for all failure modes.

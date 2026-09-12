# Refresh token security

Token source: a non-empty JSON body `refreshToken` wins over the `refresh_token` cookie.
When the body field is missing, the cookie is used. Any other body value is malformed.

Check order for a presented token:
1. Resolve and validate token shape; reject malformed.
2. Look up the token hash; reject unknown.
3. If the token is retired or family-reused, record reuse and reject.
4. If the token is past its absolute deadline, record expired and reject.
5. Otherwise atomically retire the token and insert the successor with the same `expiresAt`.

Retired is checked before expiry so a replay of an old token still triggers compromise even if the deadline has passed.
Expiry is checked before rotation so a dead deadline can never be extended.
The rotation claim is an `updateMany` conditioned on `retiredAt IS NULL` and `expiresAt > now`, so concurrent duplicates cannot both rotate.
A duplicate that loses the claim is observed as retired and is therefore treated as reuse.
All rejections return the same 401 body; audit rows store the internal reason.
Refresh tokens are stored as SHA-256 hashes, not raw values.
Audit rows record `malformed`, `unknown`, `expired`, `retired`, and `rotated` events.
Absolute lifetime is fixed at sign-in by `expiresAt`; rotation copies it unchanged.

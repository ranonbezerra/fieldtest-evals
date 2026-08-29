# Variant B — Device sessions that can be revoked

A mobile product needs sessions that survive weeks of use and can be killed from
a "your devices" screen.

## Requirements

Implement in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. Sign-in creates a **device session**: a device label, a first-seen timestamp,
   and a refresh token. `GET /auth/sessions` lists a user's sessions;
   `DELETE /auth/sessions/:id` kills one; `DELETE /auth/sessions` kills all but
   the caller's own.
2. `POST /auth/refresh` rotates the refresh token for the session it belongs to.
   The old token stops working immediately.
3. A refresh token that has already been rotated away, if presented again, means
   that device's session is compromised: kill the session, and record it so the
   user can be shown it on the devices screen.
4. Mobile clients on poor connections retry the same refresh. Two concurrent
   presentations of one token must produce exactly one rotation, and the loser
   must not be treated as an attack.
5. Sessions have a hard expiry set when they are created. Refreshing does not
   move it.
6. A killed session, an expired session and a token that never existed are
   indistinguishable in the response.

## Deliverables

- Prisma schema + migration
- NestJS module: controller, service, repository
- Tests for: the concurrent retry, revocation taking effect on the next refresh,
  the replay path, and the hard expiry
- `SECURITY.md` (15–25 lines) — in particular, how you distinguish "a client
  retried" from "someone replayed a stolen token", given that they arrive
  looking identical

Sign-in exists; assume `issueAccessToken(userId): string`.

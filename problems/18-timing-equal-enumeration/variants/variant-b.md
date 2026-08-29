# Variant B — The password-reset endpoint that answers too quickly

An existing API has `POST /auth/forgot-password`. It always returns
`202 Accepted` with `{ "ok": true }`, on purpose: whether the address is
registered must not be observable.

A penetration test came back with a finding. The response is the same; the
**time** is not. A registered address takes about 200 ms because a token is
generated, hashed, stored and an email is queued. An unregistered one returns in
under 5 ms.

## The task

Implement in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. `POST /auth/forgot-password` such that a caller cannot distinguish the two
   branches — by response, by timing, or by anything else it can observe.
2. Keep the real behaviour: a registered address genuinely receives a reset link;
   an unregistered one genuinely does not, and nothing is written for it.
3. `POST /auth/reset-password` consuming the token: single use, time-limited, and
   its own rejections indistinguishable from each other.
4. Say explicitly what happens to work that must not block the response — and
   whether moving it off the request path solves the timing problem or moves it.

## Deliverables

- Prisma schema + migration
- NestJS module: controller, service, repository
- Tests: a timing comparison over multiple samples; the responses compared
  byte-for-byte; token single-use; token expiry
- `SECURITY.md` (15–25 lines) including what an attacker with far more samples
  than your test could still learn

Assume `sendEmail(to, template, vars): Promise<void>` exists and takes 50–150 ms.

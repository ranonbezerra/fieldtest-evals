# Variant A — Refresh rotation with reuse detection

Build refresh-token rotation for an API whose sessions are long-lived and whose
clients retry aggressively.

## Requirements

Implement in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. `POST /auth/refresh` — accepts a refresh token, returns a new access token and
   a **new** refresh token. The presented token is retired by the same call.
2. The token may arrive in the JSON body as `refreshToken` or in a
   `refresh_token` cookie. Both are supported. Define and document which wins
   when both are present.
3. Clients retry. Two requests presenting the same valid token may arrive
   concurrently; **exactly one** may rotate.
4. Presenting an already-retired token is treated as compromise: every token
   descended from the same original sign-in is invalidated, and the event is
   recorded for audit.
5. A session has an absolute lifetime fixed at sign-in. Rotation issues a new
   token but never extends that deadline.
6. Every rejection — expired, retired, unknown, malformed — is indistinguishable
   to the caller. The audit record distinguishes all of them.

## Deliverables

- Prisma schema + migration
- NestJS module: controller, service, repository
- Tests for: concurrent presentation of one token, a replay that invalidates a
  sibling token, rotation against the absolute deadline, and the rejection
  responses compared to each other
- `SECURITY.md` (15–25 lines) stating the ordering between checks and why it is
  that way round

Sign-in and access-token verification already exist; assume
`issueAccessToken(userId): string`.

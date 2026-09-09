# Issue #229 — Refresh rotation, with reuse treated as compromise

**Repo:** `identity-api` · **Labels:** `security` `feature`
**Reported by:** security · **Diagnosed by:** platform

---

## Context

Sessions are long-lived and clients retry aggressively. Refresh tokens today are
long-lived and reusable, which means a stolen one works until it expires and we never
find out.

We are moving to rotation: each refresh returns a new refresh token and retires the one
presented. That closes the window, and it opens a specific new problem which is the
main thing this issue is about.

## What we need

### 1. `POST /auth/refresh`

Accepts a refresh token, returns a new access token and a **new** refresh token. The
presented token is retired by the same call.

The token arrives either in the JSON body as `refreshToken` or in a `refresh_token`
cookie. Support both, **define which wins when both are present**, and write the
precedence down where the next reader will find it.

### 2. Exactly one of two concurrent refreshes may rotate

Clients retry. Two requests presenting the same valid token will arrive at the same
time, and this is normal traffic, not an attack.

Only one may succeed. Do it with an atomic operation the database serialises — a
conditional update that retires the token only if it is still live, and a caller that
checks whether it changed a row. A read followed by a write has a window between them
and this is precisely the case that finds it.

**The loser is not a retry.** It presented a token that has just been retired, which
is indistinguishable from an attacker replaying one. Treat it as reuse. Getting this
backwards — treating reuse as a benign race — is the mistake that makes rotation
decorative.

### 3. Reuse invalidates the whole family

Presenting an already-retired token means either theft or a client bug, and we cannot
tell which. Invalidate **every token descended from the same original sign-in**, not
just the one presented and not just its direct children. Model the family explicitly so
this is one operation rather than a walk.

Record the event for audit with enough detail to investigate afterwards.

### 4. The absolute deadline is fixed at sign-in

A session has a lifetime set when it begins. Rotation issues a new token but **never
extends that deadline** — otherwise a session refreshed often enough never ends, which
is the property rotation was supposed to remove.

### 5. Every rejection looks the same to the caller

Expired, retired, unknown, malformed: one status, one body. The caller learns that the
token did not work and nothing else. **The audit record distinguishes all four.**

Route them through a single rejection path rather than four `throw`s that happen to
match today.

### 6. Check reuse before expiry

A token that is both retired and expired is a **reuse** event, not an expiry event.
Checking expiry first turns an attack into a routine log line.

## Acceptance

- Two concurrent refreshes with the same valid token → exactly one rotates
- The loser is recorded as reuse and the family is invalidated
- Presenting a retired token → every descendant invalidated, audit written
- A refreshed session still ends at its original absolute deadline
- All four rejection causes return an identical response
- A token both retired and expired is handled as reuse
- Body and cookie both accepted, with the documented precedence

## Deliverables

Prisma schema and migration · the NestJS module · tests for the acceptance cases,
including a genuinely concurrent one rather than two sequential calls.

## Notes

TypeScript, NestJS, Prisma, PostgreSQL.

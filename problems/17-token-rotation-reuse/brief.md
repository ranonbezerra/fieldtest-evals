# 17 — Refresh-token rotation with reuse detection

## The real situation

This is the task that failed as one unit of work and succeeded as three.

Rotating refresh tokens is a paragraph to describe and a minefield to implement.
Each rotation issues a new token and retires the old one. The security property
that makes it worth doing is **reuse detection**: if a retired token is ever
presented again, the presenter is either a client that lost a race or an attacker
replaying a stolen token, and you cannot tell which — so the whole family of
tokens descended from that one is torn down, and everybody re-authenticates.

The reason it is hard is not any single rule. It is that six independent
decisions all have a wrong answer that compiles, passes review, and passes most
tests:

1. **Ordering between two rejection branches.** A token that is both expired and
   already consumed: which check runs first decides whether a replayed stolen
   token triggers the alarm or is quietly dismissed as expired.
2. **Expiry inherited, not recomputed.** If each rotation extends the window, a
   stolen token is a permanent session. The family's absolute deadline is fixed
   at first issue.
3. **Tearing down a family, not revoking a token.** Revoking the presented token
   leaves every sibling live — which is precisely the set the attacker holds.
4. **The concurrent consume.** Two requests present the same valid token at once.
   Exactly one may rotate. Without a conditional update or a lock, both succeed,
   and the loser's token is now a phantom that will later look like reuse.
5. **Two places the token can arrive from** — a body field and a cookie — and one
   of them must win, deterministically, or the same request behaves differently
   depending on the client.
6. **A rejection reason that must not be disclosed.** *Expired*, *reused* and
   *unknown* must be indistinguishable to the caller, while being fully
   distinguishable in the audit log.

Each is a real decision. Each has a wrong answer that produces a working login
flow. Counting them is how you know this is not one task.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. No external identity provider — the point
is the state machine and the concurrency, not integrating a library that has
already solved it.

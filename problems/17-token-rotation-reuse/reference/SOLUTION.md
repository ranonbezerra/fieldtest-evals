# Reference solution — annotated core (KEEP OUT of the model's context)

The judging anchor, not a template. An alternative design that holds the same
properties scores on its merits.

## Schema (core)

```prisma
model RefreshToken {
  id         String    @id @default(uuid())
  // The family: every token descended from one sign-in shares this. Teardown is
  // one UPDATE on this column, not a walk up a parent chain -- a traversal can be
  // interrupted halfway, and halfway through revoking a compromised family is the
  // worst possible state.
  familyId   String    @map("family_id")
  userId     String    @map("user_id")
  tokenHash  String    @unique @map("token_hash")   // never the token itself
  status     TokenStatus @default(ACTIVE)
  // Fixed at first issue and copied to every successor. Rotation never moves it.
  familyExpiresAt DateTime @map("family_expires_at")
  expiresAt  DateTime  @map("expires_at")           // this token's own, shorter window
  consumedAt DateTime? @map("consumed_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  @@index([familyId])
}

enum TokenStatus { ACTIVE CONSUMED REVOKED }
```

## The consume, and why it is one statement

```ts
// M2. The check and the claim are one act. `updateMany` returns a count, and a
// count of 0 is the loser of the race -- which is NOT reuse, and must not tear
// the family down. The distinction is the whole of requirement 3-vs-4.
const claimed = await tx.refreshToken.updateMany({
  where: { tokenHash, status: 'ACTIVE' },
  data: { status: 'CONSUMED', consumedAt: new Date() },
});

if (claimed.count === 0) {
  // Zero could mean: never existed, already consumed, or revoked. Look, and
  // decide -- but decide in this order.
  const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });
  if (existing?.status === 'CONSUMED' || existing?.status === 'REVOKED') {
    // M4. Reuse is checked BEFORE expiry. A stolen token that is replayed after
    // it expired is still a replay, and rejecting it as "expired" is how the
    // alarm never fires.
    await tx.refreshToken.updateMany({
      where: { familyId: existing.familyId, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED' },
    });
    await audit(tx, 'refresh.reuse_detected', {
      userId: existing.userId,        // name the account. An audit row for a
      familyId: existing.familyId,    // stolen session that does not is useless
    });
  }
  throw new UnauthorizedError();      // M6: same rejection for every path
}
```

## The successor

```ts
// M5. Inherited, never recomputed. `familyExpiresAt` is copied; only the token's
// own short window is new. A rotation that sets familyExpiresAt from `now` turns
// a stolen token into a permanent session.
const next = await tx.refreshToken.create({
  data: {
    familyId: current.familyId,
    userId: current.userId,
    tokenHash: hash(raw),
    familyExpiresAt: current.familyExpiresAt,
    expiresAt: addDays(new Date(), 14),
  },
});
if (current.familyExpiresAt < new Date()) throw new UnauthorizedError();
```

## Where the token comes from

```ts
// M7. Deterministic, documented, and the same whichever a client sends. The
// cookie wins because it is the one an XSS cannot read back; a body field that
// silently overrode it would let a weaker channel decide.
const raw = req.cookies?.refresh_token ?? body.refreshToken;
```

## The check nobody writes and everybody needs

M6 is the requirement most likely to be claimed and not held. The test:

```ts
const a = await post('/auth/refresh', { refreshToken: 'never-existed' });
const b = await post('/auth/refresh', { refreshToken: expiredToken });
const c = await post('/auth/refresh', { refreshToken: replayedToken });
expect(a.status).toBe(b.status); expect(b.status).toBe(c.status);
expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));   // compare, don't read
expect(JSON.stringify(b.body)).toBe(JSON.stringify(c.body));
```

Comparing the bodies rather than eyeballing them is the point. Three handlers that
each `throw new UnauthorizedException('...')` with a different message look correct
in review and fail this.

## Counting the traps

This problem carries six, which is why it failed as one unit of work and succeeded
as three:

| # | The wrong answer that compiles |
|---|---|
| 1 | Expiry checked before reuse — the alarm never fires for a replayed stale token |
| 2 | `familyExpiresAt` recomputed on rotation — a stolen token is a permanent session |
| 3 | Revoking the presented token instead of the family — every sibling stays live |
| 4 | `findUnique` then `update` — both racers rotate; the loser's token becomes a phantom that later reads as reuse and tears down an innocent family |
| 5 | Body and cookie both read, precedence undefined — same request, different behaviour per client |
| 6 | Distinct messages per rejection — enumeration, and it reads as good error hygiene |

**A run that produced a working refresh flow and got two of these wrong is the
expected outcome, not a surprise.** The gate exists so that cannot pass.

## Common wrong answers

- A "concurrency test" that awaits two refreshes in sequence. It passes against
  the read-then-write implementation, which is the one it exists to catch.
- Teardown by walking `parentId` upward. Correct until it is interrupted.
- Storing the raw token. Nothing in the requirements forbids it explicitly, and it
  should still cost points — a database read should not yield usable credentials.
- Treating the race loser as an attack: correct-looking, and it logs every flaky
  mobile client out permanently. This is variant C's central tension.

# Verdict — 17 Token rotation and reuse

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided,
               M6 decided, M7 decided, M8 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ✓, M8 ~]

graded:       {state_machine: 3, family_modelling: 3, concurrency: 3, audit: 3,
               tests: 3, process: 2}

manifest:     8 declared, 8 built, not truncated
typecheck:    passed after 1 repair
tests:        11 of 14 pass

failure_mode: wrong_answer
              # The repository generates the successor's raw token, stores its hash,
              # and returns the database row. The service receives the row, generates
              # a *different* random token, and returns that to the caller. Every
              # token this endpoint issues is one whose hash was never stored.

revisions:    {self_repairs: 1, dropped_a_requirement: no}
cost:         {wall_minutes: 108, output_tokens: 66782, tokens_per_second: 10.3,
               requests: 12, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 12, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Gets all eight security properties right and hands the caller a token
              it never stored.

notes: |
  Every must-have is satisfied in the source, and several are satisfied well.
  M2 is a real row lock — `SELECT … WHERE token_hash = $1 FOR UPDATE` inside the
  transaction — so two concurrent presentations serialise and the second finds
  `retired_at` already set and takes the reuse path. Not a conditional update, not
  optimistic retry: the correct primitive.
  M4 is the ordering the problem is built on, and it is right. `if (row.retired_at !==
  null)` at line 65, `if (row.expires_at < new Date())` at line 72. A token that is
  both consumed and expired is treated as reuse, which is the whole point, and the
  audit row it writes is `REUSE_COMPROMISE` rather than `REJECTED_EXPIRED`.
  M3 tears down the family with `updateMany({ where: { familyId, retiredAt: null } })`,
  and M5 is achieved by the successor inheriting `expiresAt` from its predecessor —
  rotation cannot extend a deadline it copies.
  M1 retires and creates in one transaction, retiring first so a crash leaves no
  active token — and it says so in a comment.
  M6 returns one error for every rejection class. M7 accepts body and cookie, body
  wins, and the precedence is documented above the handler.
```

## Eight properties right, and the endpoint does not work

`auth.repository.ts`, inside the rotation transaction:

```ts
const newRawToken = crypto.randomBytes(32).toString('hex');
const newTokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
const newRow = await tx.refreshToken.create({ data: { tokenHash: newTokenHash, … } });
return { outcome: 'rotated', newToken: newRow, user };
```

`auth.service.ts`, handling that result:

```ts
case 'rotated': {
  const accessToken = this.issuer.issueAccessToken(result.user.userId);
  const newRawToken = crypto.randomBytes(32).toString('hex');   // ← a second one
  return { accessToken, refreshToken: newRawToken };
}
```

The repository hashes a token, stores the hash, and **throws the token away** — its
return type is `{ outcome: 'rotated'; newToken: TokenRecord; user: UserRef }`, and
`TokenRecord` is the database row. There is no field on it that could carry a raw
token. The service therefore cannot obtain the value it is supposed to return, and
instead of noticing, it manufactured a plausible one.

Every refresh issues a token whose hash is in nobody's database. The next rotation
fails with *"Refresh token is invalid."*, which is exactly what three of the fourteen
tests report — including *"returns a new, distinct refresh token that itself works for
a subsequent rotation"*, a case the model wrote itself.

**The typecheck passed.** `newRawToken` is a `string`; `refreshToken: string` is
satisfied. A compiler cannot ask whether a string is the *right* string, and this is
the third gate in the campaign to go green — on a refresh endpoint that cannot refresh.

## The closing instance of the campaign's pattern

Both halves are correct in isolation. The repository's transaction is textbook. The
service's guards, error uniformity and token-source precedence are textbook. What has
no owner is the value that has to cross between them, and the interface has no place
to put it.

This is the same failure as problem 07's `productIngredients` against a schema that
says `ingredients`, problem 03's `reDeriveWindow` on a repository that does not define
it, and problem 15's module that imports a service one directory over. Here it is at
its most distilled, because nothing else is wrong: **eight security must-haves, a clean
typecheck, one value dropped at a layer boundary, and a product that does not function.**

M8 is `~` for the same reason it is nearly `✓`: the suite is good — fourteen cases
including a genuinely concurrent consume and a replay that kills a live descendant —
and it is the only thing in this run that noticed.

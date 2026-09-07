# Verdict — 17 Refresh-token rotation with reuse detection (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ✓, M8 ✗]

graded:       {concurrency_design: 3, family_semantics: 3, api_discipline: 3,
               test_design: 3, quality: 2, process: n/a}

typecheck:    failed — 22 errors with the harness's damage undone (84 as run)
tests:        did not run — the suite does not compile

failure_mode: wrong_answer
              # `let repo: RepoContract`. The fake is built from `vi.fn()`s and then
              # annotated with the plain repository interface, which erases the mock
              # type. Eighteen of the twenty-two errors are `Property
              # 'mockResolvedValue' does not exist`, and the suite that proves every
              # must-have never runs.

revisions:    {self_repairs: 2, dropped_a_requirement: no}
cost:         {wall_minutes: —, output_tokens: —, requests: 3, usd: —}
host:         {n/a — the model is not on this machine}

harness_note: |
  As run, this gate reported 84 syntax errors. Its second repair round returned a
  fenced block whose content was `<result><name>Read</name><output>…` — the model
  transcribing a tool call it does not have — and ft-run wrote it over 99 lines of
  working service. Restored from the first repair's reply; the 22 errors above are a
  fresh typecheck of that state. `ft-run` now refuses a reply that opens with a
  tool-call transcript, in addition to refusing an unfenced one.

would_merge:  after one type annotation
headline:     Seven of eight must-haves, the best concurrency design in either
              campaign, and a test suite that cannot compile because of one word.
```

## The design is right, and right for the right reasons

**M2, race-safe consume.** A compare-and-swap, not a read-then-write:

    const result = await tx.refreshToken.updateMany({ where: { …, consumedAt: null } });
    return result.count === 1;

and in the service:

    // If it fails, another request already rotated this token — treat as reuse.

That second line is the whole problem. The loser of the race is not an error to retry
or a benign duplicate: it is presenting a token that has just been consumed, which is
indistinguishable from an attacker replaying it. Treating it as reuse is correct and
most implementations get it wrong.

**M3** `RefreshFamily` with `familyId` on every token, `@@index([familyId])`, and a
single `updateMany` to kill the family. **M4** the reuse branch is at line 28 and the
expiry check at line 37 — the order the must-have requires, so a token that is both
consumed and expired is treated as reuse. **M5** the family carries its own
`expiresAt`, fixed at sign-in, which rotation does not extend. **M7** body wins over
cookie, stated in a comment and implemented in one expression.

**M6** is a single private method:

    private reject(): never {
      throw new UnauthorizedException({
        error: { code: 'invalid_token', message: 'Invalid refresh token.', details: {} }
      });
    }

Every rejection path calls it. There is no way for expired, reused, unknown and
malformed to diverge, because there is only one exit.

## And the suite that proves all of it does not compile

The tests are the right tests. Their names are:

    exactly one of two concurrent rotate calls succeeds; the other is rejected
    presenting an already-retired token revokes every token in the family
    rejects rotation when the session has passed its absolute expiry
    unknown, expired, and retired (reuse) all produce the same envelope

That is M8's list. The fakes are built correctly:

    findTokenById: vi.fn().mockResolvedValue(null),
    retireTokenIfActive: vi.fn().mockResolvedValue(0),

and then, 37 lines earlier:

    let repo: RepoContract;

The annotation is the plain repository interface. `repo.findTokenById` is therefore
typed as `(id: string) => Promise<TokenRow | null>`, which has no `.mockResolvedValue`.
Eighteen errors, one cause, and the fix is `MockedObject<RepoContract>` or no
annotation at all.

**One word between this run and a pass.**

## The pattern, at its smallest

| problem | the two things that disagreed | cost |
|---|---|---|
| 04 | `capitalizeFirst(...)` vs `toContain('several shards')` | 1 test |
| 09 | `createTrip(userId, dto)` vs a four-argument call | 3 tests |
| 06 | `esModuleInterop: true` vs `import * as request` | 8 errors |
| **17** | **`vi.fn()` fakes vs `let repo: RepoContract`** | **18 errors, the whole suite** |

Four problems, four instances, all inside a single reply, none caused by the
decomposition or the ceiling. The model writes each artifact correctly and does not
re-read what it has already written to check that the next one agrees.

That is the campaign's finding, and problem 17 is its most expensive example: the
strongest security design in either campaign, unverifiable because of a type
annotation.

# Verdict — 17 Refresh-token rotation with reuse detection (gpt-oss-120b, hosted)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ~, M2 ✗, M3 ✗, M4 ~, M5 ✓, M6 ✓, M7 ~, M8 ✗]

graded:       {concurrency_design: 0, family_semantics: 2, api_discipline: 2,
               test_design: 1, quality: 0, process: n/a}

typecheck:    failed after 2 repairs — 21 errors
tests:        did not run

failure_mode: reference_gap
              # The service calls `findSession`, `invalidateSessionChain`,
              # `recordAudit` and `retireToken`. The repository the same reply wrote
              # defines `findSessionByToken`, `invalidateSession`, `recordAuditEvent`
              # and `retireRefreshToken`. Four of five calls miss.

revisions:    {self_repairs: 2, dropped_a_requirement: no}
cost:         {wall_minutes: ~3, requests: 3, usd: 0.0051}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     A sound family model with an absolute deadline, wired to a repository
              that exists under different names — and no compare-and-swap anywhere.
```

## What holds

The schema is valid and well shaped. `Session` carries `expiresAt` — the absolute
deadline fixed at sign-in — and `revokedAt`; `RefreshToken` hangs off it with
`sessionId` and `parentId`. Back-relations are declared on both sides, so
`prisma generate` succeeds, unlike this model's problems 06 and 07.

M5 follows directly: rotation issues a new token against the same session and cannot
extend the session's own deadline. M6 holds — every rejection routes through the same
`UnauthorizedException`, and the service's header says so: "All rejections (expired,
retired, unknown, malformed) …".

Reuse *detection* is present and in the right place:

    if (tokenRecord.retiredAt) {
      await this.authRepository.invalidateSessionChain(sessionId, { … });

## What does not

**M2, race-safe consume, has no attempt.** There is no `updateMany … where retiredAt:
null` followed by a `count === 1` check, no `SELECT … FOR UPDATE`, and no
`$transaction` in the auth path. Two concurrent presentations of the same valid token
both read it as live and both rotate. This is the must-have Qwen3.8-27B answered with
a compare-and-swap and a comment explaining why the loser is reuse, not a retry.

**M3, family teardown, is broken twice over.** `invalidateSessionChain` does not exist;
the repository's nearest method is `invalidateDescendants(rootTokenId: number)`, whose
body matches only `{ parentId: rootTokenId }` — direct children, not descendants,
despite the name and a comment claiming otherwise. It also takes a `number` where the
model's own schema declares `id String @id @default(uuid())`, and hedges in a comment:
"If the schema stores a `rootId` to simplify queries, include it here." The schema is
thirty lines away in the same reply.

**M8** the tests never compile, so nothing is proven.

Four of the service's five repository calls name methods that do not exist:

    findSession            → findSessionByToken
    invalidateSessionChain → invalidateSession
    recordAudit            → recordAuditEvent
    retireToken            → retireRefreshToken

Each is a near-miss of a real name — the same signature of the defect as problem 01's
twelve, problem 05's `findIntent`, and problem 07's `classify`.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B | gpt-oss-120b |
|---|---|---|
| must-haves | **7 of 8** | 2 of 8 clean |
| race-safe consume | `updateMany … count === 1`, loser treated as reuse | absent |
| family teardown | one `updateMany` over the family | direct children only, method missing |
| absolute deadline | `RefreshFamily.expiresAt` | `Session.expiresAt` ✓ |
| uniform rejection | `private reject(): never` | one exception path ✓ |
| what broke it | `let repo: RepoContract` — one annotation | four undefined methods and no CAS |
| verdict | FAIL | FAIL |

Qwen's run was one word from a pass. This one is missing the concurrency control the
problem is named for.

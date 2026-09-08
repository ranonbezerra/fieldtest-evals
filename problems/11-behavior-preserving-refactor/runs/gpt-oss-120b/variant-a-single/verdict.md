# Verdict — 11 Behavior-preserving refactor (gpt-oss-120b, hosted, single request)

```yaml
verdict:      PASS
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {refactor_quality: 3, open_track: n/a, archaeology: 3,
               test_quality: 3, quality: 3, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        13 of 13 pass, 3 files

failure_mode: none

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: ~1, requests: 1, usd: 0.0007}
host:         {n/a — the model is not on this machine}

would_merge:  yes
headline:     Three copies became one, all three call sites delegate, the quirk
             survives as an option, and the uncovered copy got its characterization
             test first — in one request, for seven hundredths of a cent.
```

## M4, which is the problem

    src/orders/orders.status.ts    import { mapProviderStatus as sharedMap } from '../shared/payment-status-mapper.js'
    src/payouts/payouts.status.ts  import { mapProviderStatus as sharedMap } from '../shared/payment-status-mapper.js'
    scripts/reporting.ts           import { mapProviderStatus as sharedMap } from '../src/shared/payment-status-mapper.js'

All three, including the reporting script — the one Qwen3.8-27B left byte-identical
with its own switch while its NOTES.md claimed otherwise. `src/shared/` contains
exactly one file.

## M2, which is the trap

The three copies did not behave identically, and the task is to preserve that rather
than tidy it. The shared mapper carries the divergence as configuration:

    /** When true, unknown provider codes are mapped to the literal string 'unknown'. */
    unknownAsUnknown?: boolean;
    /** When true, unknown provider codes are mapped to null. */
    …
    /** This is required only by the legacy reporting script. */
    legacyReportCasing?: boolean;

Each call site keeps the behaviour its copy had. The reporting quirk is an explicit
option used by one caller and documented as legacy, which is what the variant asks for
in exactly those words.

## M3, M5, M6

`test/reporting.spec.ts` is new — the characterization test for the copy that had no
coverage, written before the move, which is the ordering M3 requires.

The delivery is six files and three of them are new: the mapper, that spec, and
`NOTES.md`. Nothing else was added. Against the previous seven problems in this
campaign that is worth stating plainly: **no invented NestJS application, no controller,
no repository, no prisma schema.** The fixture is ten files and the answer is scoped to
it.

The fixture's `orders.status.spec.ts` and `payouts.status.spec.ts` are byte-identical
and green. Thirteen tests pass, `tsc --noEmit (attempt 0) -> 0`, zero repairs.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (blind) | gpt-oss-120b (fixture visible) |
|---|---|---|
| must-haves | 5 of 6 — **M4 failed** | **6 of 6** |
| call sites delegating | 2 of 3 | **3 of 3** |
| the third copy | untouched, and NOTES.md said it delegated | edited |
| files added beyond the refactor | 24, including a NestJS app and a prisma schema | 0 |
| tests | 22 pass | 13 pass |
| typecheck | clean, 0 repairs | clean, 0 repairs |
| verdict | FAIL | **PASS** |

Qwen's run was the campaign's argument that a green pipeline cannot see whether the job
was done. This one is the counterpart: the same green pipeline, and the job was done.

Two things separate them. The 27B was blind and invented a third call site named
`generate-status-report.ts` rather than editing `reporting.ts`; this run could read
`reporting.ts` and edited it. And the 27B, given a ten-file fixture, built an
application around it, where this run did not.

**Second consecutive pass for this model on a fixture problem, after seven greenfield
failures.** The pattern is holding: given code to read, it reads it and makes a small
correct change. Given a blank page, it produces the shape and leaves the body out.

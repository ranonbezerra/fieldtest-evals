# Verdict — 13 Legacy characterization tests (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓ literally, M2 ✗, M3 ✗, M4 ~, M5 ✗, M6 ✗]

graded:       {input_space: 0, pinning_discipline: 0, findings_quality: 0,
               determinism: 2, quality: 0, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        15 of 53 pass

failure_mode: wrong_answer
              # It did not characterize the legacy module. It wrote a different fee
              # calculator at a new path and characterized that. The fixture's
              # `feeCalculator.ts` uses STANDARD / COMMERCIAL / ESTATE / APPEAL and
              # rate tables for 2019, 2021 and 2022. The module the tests import uses
              # `criminal` and `civil`. The word "criminal" appears zero times in the
              # fixture.

revisions:    {self_repairs: 0, dropped_a_requirement: yes}
cost:         {wall_minutes: —, output_tokens: —, requests: 1, usd: —}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     A confident, detailed, well-organised characterization of a module that
              did not exist until the model wrote it.
```

## The module under test is the model's own

    workspace/feeCalculator.ts                      the fixture, untouched
    workspace/src/fee-calculator/fee-calculator.ts  written by the model
    workspace/test/fee-calculator.spec.ts           imports the second one

The fixture:

    export type CaseType = 'STANDARD' | 'COMMERCIAL' | 'ESTATE' | 'APPEAL';
    interface CaseInput { type; complexity: number | null; openedAt; deadline?; expedited? }
    const RATE_TABLE_2019 = { base: { STANDARD: [12000, 18500, 27000, 41000], … } }

What the tests import:

    export type CaseType = 'criminal' | 'civil' | …
    fee({ openedAt, filedAt, now })

Not a refactor, not a rename. A different domain. `workspace.json` is explicit —
`the fixture the deliverable is written against; it is never edited` — and the model
did not edit it. It ignored it.

M1 is green in the letter and empty in substance: the production code is untouched
because the model never went near it.

## The report is the worrying part

`FINDINGS.md` is six findings, worst-first, each with a reproducing input and a
severity:

    F1 — urgency: a 1-second-over-24h gap silently downgrades same-day cases from 1.5×
    F2 — double rounding: the step-2 and step-3 Math.round can move the total
    F3 — table drift from the runbook: 2021 criminal HIGH and 2021 tenant CRITICAL …
    F4 — inconsistent boundary semantics on the two date transitions
    F5 — degenerate inputs pass straight through
    F6 — quirks pinned without a clear intent

and the test names match its tone:

    [QUIRKY-VALUES] the shipped tables differ from the runbook in two cells — pinned as-is
    pins EVERY shipped table cell (18 rows) verbatim — drift here is a rate change

"The shipped tables." "Verbatim." None of it is shipped, and there is no runbook. The
real planted quirks — a `>=` where a `>` belongs on the second rate-table transition,
and a timezone off-by-one on the boundary day — are not among the six, because the
model never read the code that contains them.

This is the failure mode the problem exists to catch, arrived at from an unexpected
direction. The task is to resist the urge to fix and to write down what the code
*actually does*. The model wrote down, in detail and with evidence formatting, what
some code does. It was not this code.

## And it does not even agree with its own invention

**38 of its 53 assertions fail** — against the module it wrote itself, in the same
reply. `criminal / high pins the shipped fee`, `civil / medium pins the shipped fee`,
`selects the 2021 table for an opening date between the two transitions`: all failing.

The campaign has shown this model disagreeing with itself about a capital letter, a
call signature and a file extension. Here it disagrees with itself about the contents
of eighteen rate-table cells it invented minutes earlier.

## Why the gate said nothing

`tsc --noEmit (attempt 0) -> 0`, zero repairs. Of course: a self-consistent invention
typechecks. The gate compiles what it is given and cannot ask whether it is about the
right thing.

Problem 11 passed every test and left the duplication in place. This one compiles
clean and characterizes fiction. **Neither failure is visible to any automated check
in this harness**, and both are obvious to a reader who opens the fixture.

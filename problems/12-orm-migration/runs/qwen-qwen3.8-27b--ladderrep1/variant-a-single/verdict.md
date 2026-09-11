# Verdict — 12 Dependency migration (qwen3.8-27b, **ladder**, rep 1)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b, providers pinned}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ~, M3 ✓, M4 ~, M5 ✓, M6 ✓]

graded:       {trap_discovery: 2, mapping_quality: 3, migration_notes: 3,
               ambiguity: n/a, quality: 3, process: n/a}

typecheck:    clean at attempt 0 — no repair
tests:        **17 of 17 pass**, including two that inject a mid-transaction failure

failure_mode: none
              # `prisma generate` exits 1, which is correct here: the model removed
              # Prisma, which is the objective. The gate runs it unconditionally.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
would_merge:  yes
headline:     The atomicity proof the issue asked for, written and passing — the first
              time any condition has produced it on this problem.
```

## §3 of the issue, answered

The issue said: *"Prove it still does with a test that **injects a failure
mid-transaction** and asserts nothing was written — not a test that calls the happy
path and checks the rows exist."*

    ✓ commits the invoice, its line items and the account counter when all …
    ✓ writes NOTHING when the line-item insert fails mid-transaction
    ✓ writes NOTHING when the counter bump fails (invoice and line items rolled back)

Two failure injections at two different points, each asserting the absence of every
write. That is the test the requirement describes, and **no earlier condition on this
problem produced it.**

Seventeen tests pass in total, covering the read paths, the empty-account case and the
status transition.

## Against the same problem in every earlier condition

| | repository ported | dependency declared | pre-existing suite | atomicity proven |
|---|---|---|---|---|
| qwen local, phased | in new files beside the old | **no** | untouched | no |
| qwen hosted, no issue | **no** | yes | untouched | no |
| gpt-oss, no issue | yes | yes | **rewritten** | no |
| **this run** | **yes** | **yes** | **passing** | **yes** |

Each earlier attempt failed a different half. This one does both halves and proves the
part that matters.

## The notes

`trap_discovery: 2` — `MIGRATION_NOTES.md` is present and substantive, and the BigInt
serialization contract is addressed. The line-item ordering trap is not, so one of the
three planted behaviours is unaccounted for.

`prisma generate -> 1` in the gate log is not a defect of this run. The model removed
Prisma from `package.json`, which is §1 of the issue, and the gate runs `prisma
generate` whenever a `prisma/` directory exists. That is recorded in SECOND-PASS and is
the harness's to fix.

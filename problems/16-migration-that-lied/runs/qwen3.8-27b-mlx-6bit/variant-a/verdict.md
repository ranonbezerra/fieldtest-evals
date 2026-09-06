# Verdict — 16 The migration that lied

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided,
               M6 decided, M7 decided]
gate:         [M1 ~, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 verified externally, M7 ✓]

graded:       {diagnosis: 2, verification_design: 3, fix_quality: 3, honesty: 3,
               runbook: 3, process: 1}

manifest:     4 declared, 4 built, not truncated
typecheck:    passed, 0 errors — after correcting a harness-injected type reference
tests:        n/a — this problem ships no suite
verification: run against a live Postgres. Both checks distinguish the broken state
              from the fixed one; the backfill moves all five rows.

failure_mode: reference_gap
              # All four phases declared `reads: nothing`. The four migration files
              # were in the workspace and none was opened. Defect 3's mechanism is
              # invented as a result — and flagged as invented, which is the run's
              # best moment.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 16, output_tokens: 8927, tokens_per_second: 10.4,
               requests: 5, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 5, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  after_changes
headline:     Names all three silent failures, gets one mechanism wrong, and says
              out loud which part it is guessing.

notes: |
  Sixteen minutes and 8,927 tokens — the cheapest run in the campaign, and the
  second-best.
  All three seeded defects are named. Defect A covers the journal (`0003` on disk and
  absent from `_journal.json`, so `drizzle-kit migrate` applies three files and prints
  success) and, as a sub-finding, the extension `postgres:16-alpine` cannot provide —
  which is the right grouping, because the reference itself says defect 1 hides
  defect 2.
  Defect B names the third: the backfill matches zero rows, the `DO $$` block succeeds,
  `search_key` stays null everywhere. The symptom is exact.
  **The mechanism is wrong.** It reconstructs the migration as
  `UPDATE … WHERE search_key IS NOT NULL` and calls the predicate inverted. The real
  `0002` filters `public_ref LIKE 'slug:%'`, and `0001` stripped that prefix one
  migration earlier — a cross-migration interaction, not a typo.
  M4 holds anyway, and not by luck alone: the fix it writes is
  `UPDATE documents SET search_key = lower(title) WHERE search_key IS NULL`, which
  carries no `LIKE` filter at all and therefore moves every affected row regardless of
  which mechanism broke it. A broader fix survives a wrong diagnosis.
  M5 is the criterion the reference says runs will fail, and this one does not. Check 1
  queries `information_schema.tables` for `document_embeddings` — the catalog, not the
  directory, which is precisely the distinction the answer key draws. Check 2 counts
  `search_key IS NOT NULL`, which is zero on the broken state and non-zero on the
  fixed one.
  M7: both fixes are additive files ordered after the existing set, and neither
  rewrites history.
```

## The honesty, against problem 13

Both runs declared `reads: nothing` for every phase, and both then wrote about code
they had not opened. What they did with that is opposite.

Problem 13 presented a reconstructed snippet under a `// Before (buggy):` heading in a
findings report — invented code dressed as observation.

This run wrote:

    -- ASSUMPTION: the intended SET expression is lower(title); the broken
    -- migration's exact expression could not be read.

and, in the runbook:

    > // ASSUMPTION: The inverted predicate is the most defensible single-statement
    > explanation for "green run + all NULLs". The implementer confirms the exact
    > WHERE clause during Phase 2.

Same model, same configuration, same failure to declare a read, and here it names the
boundary of what it knows and hands the confirmation to a human. Problem 13's silence
was therefore not an inability to recognise a guess. That contrast is the most useful
thing in either run.

## What the gate said, and what was true

The recorded gate was `passed: false` on a single error:

    error TS2688: Cannot find type definition file for 'vitest/globals'

This workspace carried its own `package.json` — drizzle-orm, pg, drizzle-kit,
typescript, and correctly no vitest, since the deliverable is migrations and shell.
The harness supplied only `tsconfig.json`, and its `types` array demands
`vitest/globals`. Half a scaffold depending on the half it did not supply. There was
no file to repair, so the gate stopped at zero repairs.

Re-run with that one entry removed: **0 errors**. `meta.yaml` is corrected in place,
and `ft-go` now drops `vitest/globals` from a supplied tsconfig when the workspace's
own `package.json` has no vitest.

## M6 is unrunnable by the model, so it was run from outside

*"Verification is runnable and was run … the deliverable shows the output."* The model
has no shell, no database and no tools, so the criterion cannot be met by any run under
this harness. Marking it failed would record our constraint as the model's. Instead the
script was executed against a live Postgres 14, and it earns the criterion on the only
axis the model controls: whether what it wrote actually runs and actually distinguishes.

**The broken state, reproduced from the fixture's own journal** — `0000`, `0001`,
`0002` applied, `0003` absent from `_journal.json` and therefore never run:

    5 rows, 0 with search_key
    document_embeddings: does not exist
    public_ref: onboarding-guide · refund-policy · security-overview

The last line is the real defect 3 in one glance: `0001` stripped the `slug:` prefix,
so `0002`'s `LIKE 'slug:%'` matched nothing and the `DO $$` block succeeded over zero
rows.

**`scripts/verify.sh` against it:**

    FAIL document_embeddings table missing
    FAIL search_key empty (0 rows with non-NULL search_key)
    exit 1

Both defects named, and a non-zero exit — which matters more than usual in a problem
about a pipeline that reports success while doing nothing.

**After applying both fix migrations:**

    00NN_fix_document_embeddings.sql → ERROR: could not open extension control file
    00NN_fix_search_key_backfill.sql → (clean)

    FAIL document_embeddings table missing
    PASS search_key backfilled (5 rows)
    exit 1

M4 is confirmed: **five of five rows backfilled**, by a fix written from a wrong
mechanism. Its `WHERE search_key IS NULL` carries no `LIKE` filter, so it repairs the
damage whatever caused it.

And the remaining FAIL is the correct outcome, not a shortfall. The reference says
fixing the journal alone takes the pipeline *"from silently wrong to loudly broken —
which is progress"*. That is exactly what happened: the extension is unavailable, the
migration aborts loudly, and the verification says so. The model kept
`postgres:16-alpine` and annotated it `# Plain Postgres. Does NOT ship pgvector`,
documenting it as a finding. The reference warns that a run adding `IF NOT EXISTS` and
declaring it handled *"has understood neither"*, and that removing the feature to get
green is worse. It did neither.

*One fidelity note:* this was run against a local PostgreSQL 14, not the
`postgres:16-alpine` the compose file pins. Nothing checked here is version-sensitive —
`DO $$`, `LIKE`, `replace()` and `information_schema` behave identically — and neither
image ships pgvector, so defect 2 reproduces the same way. A re-run against the pinned
image would confirm rather than change this.

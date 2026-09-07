# Verdict — 16 The migration that lied (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✗, M2 ✗, M3 ~, M4 ✗, M5 ~, M6 ✗, M7 ✗]

graded:       {diagnosis: 0, verification_design: 3, fix_quality: 0, honesty: 1,
               runbook: 1, process: n/a}

typecheck:    passed on attempt 0
tests:        n/a — this problem ships no suite
verification: not run. There is no database in the hosted campaign's test step,
              and the task requires one.

failure_mode: harness_artifact
              # Blind, and doubly unrunnable. The model was never shown the fixture,
              # and the task's first instruction is "bring up the environment, apply
              # the migrations as the pipeline does" — which no request in this shape
              # can do.

revisions:    {self_repairs: 0, dropped_a_requirement: yes}
cost:         {wall_minutes: —, output_tokens: —, requests: 1, usd: —}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     It designed exactly the right three checks for symptoms it was told
              about, and invented a cause, a filename and a migration journal for the
              code it could not read.
```

## The checks are right

`scripts/verify.sh` — the one file it wrote into the real tree — opens:

    # Checks, one per defect/finding:
    #   D1  public.document_embeddings exists
    #   F3  extension "vector" is installed
    #   D1  document_embeddings.embedding is type vector
    #   D2  every document has a non-NULL search_key

Three checks, three planted defects. The missing table, the unavailable pgvector
extension, and the backfill that matched nothing all have a check that distinguishes
the broken state from the fixed one. `verification_design: 3` is earned: this is what
M5 asks for and it is designed correctly.

Two of the three came from the brief, which states the symptoms outright. The third —
the extension — came from the Constraints paragraph's hint. Nothing here required
reading the migrations, which is fortunate, because it could not.

## Everything upstream of the checks is invented

    ## Defect D1 — `0001_document_embeddings.sql` is a comment-only no-op

There is no `0001_document_embeddings.sql`. The fixture has `0001_rename_slug.sql`,
and the real defect is that `0003_embeddings.sql` **exists on disk and is absent from
`drizzle/meta/_journal.json`** — so `drizzle-kit` reads the journal, applies three
migrations, prints success, and never creates the table. The model's story, a
comment-only file, would produce the same symptom by a different route it made up.

M2 is the must-have that names this: *the unregistered migration is fixed by
registering it correctly in the journal.* The model did write a journal — into
`fixtures/service/drizzle/meta/_journal.json`, a directory it created — and its
entries are

    0000_init, 0001_document_embeddings, 0002_backfill_search_key

against the real

    0000_documents, 0001_rename_slug, 0002_backfill_search_key

Two of three tags invented, and `0003_embeddings` — the entire point — registered
nowhere. The real journal at `drizzle/meta/_journal.json` is byte-identical to the
fixture.

M4 fails the same way: the corrected backfill went to
`fixtures/service/drizzle/0004_backfill_search_key.sql`, which the pipeline at
`drizzle/` will never see.

## Against the local run of the same problem

| | local, phased | hosted, single |
|---|---|---|
| saw the fixture | **yes** — the plan named it under `reads:` | **no** |
| defect 1 identified | journal, correctly | invented a comment-only file |
| journal fixed | ✓ | wrote a different journal, in a different tree |
| backfill | ✓ moves all five rows, verified live | in a tree the pipeline does not read |
| verification run | against a live Postgres, both states | not run |
| verdict | **PASS_WITH_NOTES** | **FAIL** |

This is the campaign's clearest demonstration that the blindness, not the model,
produced these hosted results on problems 09–16. Same model, same problem, same week.
Given the migrations to read, it found the journal defect and fixed it. Given a prose
description of the symptoms, it produced a runbook that is confident, well-structured,
and about a file that does not exist.

## This problem needs more than the fix that was made today

Handing over the seeded files repairs the blindness. It does not repair the rest: this
task begins "bring up the environment, apply the migrations as the pipeline does" and
ends "show its real output, from both" states. A single request with no shell can do
neither. Problem 16 measures what it is meant to measure only in a shape that lets the
model run something — which, in this harness, is the phased run against a live
database, exactly as the local run was judged.

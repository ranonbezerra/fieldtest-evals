# Verdict — 16 The migration that lied (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✗, M2 ✗, M3 ✗, M4 ~, M5 ~, M6 ✗, M7 ✗]

graded:       {diagnosis: 1, verification_design: 2, fix_quality: 1, honesty: 1,
               runbook: 0, process: n/a}

typecheck:    n/a — the deliverable is SQL and a shell script
tests:        n/a. Verification not run: no database, and the task requires one.

failure_mode: wrong_answer
              # It attributed the missing table to the pgvector failure — "Creating
              # the extension fails, so the migration never ran" — when the migration
              # never ran because it is absent from `drizzle/meta/_journal.json`.
              # Believing that, it never touched the journal, and then shipped two
              # new migrations unregistered in it.

revisions:    {self_repairs: 0, dropped_a_requirement: yes}
cost:         {wall_minutes: ~2, requests: 1, usd: 0.0022}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     Its correction reproduces the defect it was hired to find: two new
              migration files on disk, neither of them in the journal.
```

## The fix repeats the bug

Defect 1 is that `0003_embeddings.sql` sits in `drizzle/` and not in
`drizzle/meta/_journal.json`, so `drizzle-kit migrate` reads the journal, applies
three migrations, prints success, and never creates the table.

After this run the directory holds **six** SQL files:

    0000_documents.sql  0001_rename_slug.sql  0002_backfill_search_key.sql
    0003_embeddings.sql            ← the original, still unregistered
    0003_document_embeddings.sql   ← new
    0004_backfill_search_key.sql   ← new

and the journal still reads:

    ['0000_documents', '0001_rename_slug', '0002_backfill_search_key']

Two corrective migrations were written and neither was registered. **The deploy would
stay green and the database would stay broken**, which is the sentence the problem
exists to make a model say.

## The misdiagnosis that caused it

`0003_document_embeddings.sql` opens:

    -- The original migration that created the embeddings table relied on the
    -- pgvector extension, which is not available in the plain postgres:16-alpine
    -- image used by the compose file. Creating the extension fails, so the
    -- migration never ran and the table was never created.

The first sentence is correct and is defect 2, found by reading `docker-compose.yml` —
something the blind Qwen run could not do. The second is wrong. The migration never
ran because the journal does not list it; the extension was never attempted, which is
precisely why the loud failure never happened. The reference states this as the crux:
"defect 1 hides defect 2".

Having decided the extension was the cause, the model had no reason to look at the
journal, and did not.

## M3 and M4

The replacement migration "solves" the extension problem by storing `embedding` as
`text` instead of `vector`. The variant's constraints are explicit: "If an extension
cannot be installed on the image the compose file specifies, that is a **finding, not
an obstacle to work around**." Changing the column type is working around it, and
silently degrades the data model — `docker-compose.yml` is untouched, still
`postgres:16-alpine`.

M4 is the one piece of real correction: `0004_backfill_search_key.sql` runs
`UPDATE "documents" … WHERE "search_key" IS NULL`, dropping the
`public_ref LIKE 'slug:%'` filter that matches nothing after `0001` strips the prefix.
That is the right fix for defect 3 — in a file the pipeline will never apply.

`scripts/verify.sh` is real, with `psql` queries against the corrected state. No
`RUNBOOK.md` was written, which the task asks for by name; `runbook: 0`.

## Against Qwen3.8-27B on the same problem

| | Qwen local (phased) | Qwen hosted (blind) | gpt-oss-120b |
|---|---|---|---|
| defect 1 identified | **yes, journal** | invented a comment-only file | misattributed to the extension |
| journal fixed | **yes** | wrote a different journal, in a tree of its own | untouched |
| defect 2 (pgvector) | yes | hinted from the brief | **yes, read from the compose file** |
| defect 3 backfill | **yes, moved five rows live** | wrong tree | correct SQL, never applied |
| RUNBOOK | yes | yes, about a file that does not exist | absent |
| verdict | **PASS_WITH_NOTES** | FAIL | FAIL |

Seeing the fixture bought a genuine reading of `docker-compose.yml` and a correct
backfill. It did not buy the journal, and the journal is the problem. The local 27B,
which could also read the migrations, found it.

# Verdict — 07 Ingredient classification

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {schema_design: 3, rule_semantics: 2, confidence_model: 2, tests: 3,
               quality: 2, process: 3}

manifest:     27 declared, 27 built, not truncated
typecheck:    failed after 40 repairs — 6 errors
tests:        could not run — the suite needs a live Postgres

failure_mode: reference_gap
              # Six errors, and four are two structural gaps. Three are
              # `prisma.service` — used in three repositories, imported by three
              # different paths ('../prisma.service.js', '../prisma/prisma.service.js',
              # '../prisma.service'), and never declared in the manifest, so no phase
              # wrote it. Two are methods the controllers call that their services do
              # not have: `MethodologyService.create`, `ClassificationService.getResults`.

revisions:    {self_repairs: 40, dropped_a_requirement: no}
cost:         {wall_minutes: 380, output_tokens: 218160, tokens_per_second: 9.6,
               requests: 69, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 69, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  after_changes
headline:     Six errors from a run of sixty-nine requests, and four of them are one
              file nobody was asked to write.

notes: |
  The cleanest compile in the campaign by error count, and it still fails.
  All six must-haves hold. M1 versions the methodology as its own table with rules
  keyed `[methodologyVersionId, ingredientId]`, so two versions coexist. M2 is
  genuinely idempotent: the repository deletes a result's findings and recreates
  them inside one transaction, so a rerun replaces rather than accumulates. M3
  surfaces unknowns as `resolvedName: null` and feeds their count into an explicit
  confidence figure. M4 gives every finding a `severity` and a `sourceCitation`
  rather than a verdict. M5 composes profile modifiers **tighten-only** over the base
  rules, which is the right composition law for this domain. M6 normalizes through
  NFD and a synonym table before any rule runs.
  Process scores 3 on the legal-surface constraint the rubric asks about: every
  response carries a `DISCLAIMER`, and the output is flags rather than a judgement.
  Six tests, and they name the traps: profile flips a finding from watch to banned,
  unknown lowers confidence and stays visible, a typo resolves through synonyms,
  reruns are identical, shuffled ingredient order yields the same finding set, both
  methodology versions coexist after publish. None ran.
  The confidence model is where it thins out. `1 - 0.1 × unknownCount` is explicit
  and crude — linear in an arbitrary constant, blind to how many ingredients were
  recognised, so a product with two unknowns of three scores the same as one with two
  of forty.
```

## The two structural gaps, and why the compiler caught one of them

`prisma.service` is imported by three repositories, by three different paths:

    '../prisma.service.js'
    '../prisma/prisma.service.js'
    '../prisma.service'

The file does not exist and the manifest never named it. Identical to problem 01,
where the plan designed both repositories around `PrismaService` and never commissioned
it — except here the three phases could not even agree on where the file they were all
assuming would live.

The other two errors are methods that do not exist: `methodology.controller.ts` calls
`MethodologyService.create`, `product.controller.ts` calls
`ClassificationService.getResults`, and neither service has them. A later phase wrote
against an interface an earlier phase did not provide.

**TypeScript caught this one**, and that is the confirmation problem 03 needed. There,
25 of 31 errors were unresolved imports, so the compiler never typechecked the calls
into those modules and two services calling non-existent repository methods passed
unremarked until the suite crashed. Here the extension convention is right — **54 of 55
relative imports carry `.js`** — the modules resolve, and the same class of defect
surfaces at compile time as `TS2339`.

A typecheck that cannot resolve a module is silent over exactly the surface where
phases disagree. This run is what it looks like when it can.

## The suite needs a database the harness does not run

    PrismaClientInitializationError

The tests are integration tests against a live Prisma client. Problems 01–06 mostly
wrote mock-based suites that ran; this one wrote the other kind, which is a legitimate
choice and arguably the better one for a rules engine backed by tables.

`README.md` already acknowledges this for the manual path — *"docker compose up -d db
… else run Postgres yourself"* — but the automated test step added in §3.7 has no
database. So the observation lands or not depending on which testing style a run
happens to choose, which is not a property of the model worth recording.

Goes to `SECOND-PASS.md` beside the missing packages: the test step needs a disposable
Postgres, or the runs that write integration tests are silently unmeasured.

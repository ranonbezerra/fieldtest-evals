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
tests:        0 of 6 pass, run against a disposable Postgres

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

would_merge:  no
headline:     One file nobody was asked to write hid a wrong relation name in every
              query of a repository, and only a real database said so.

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
  methodology versions coexist after publish.
  All six fail, in the same place, for the same reason. `product.repository.ts`
  queries `include: { productIngredients: ... }`; the schema names that relation
  `ingredients`. Every query in the file carries the wrong name, so nothing about
  this domain logic was ever exercised.
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

## What the database found, and why nothing else could

The suite is integration tests against a live Prisma client, so the harness's test step
— which has no database — reported nothing. Run against a disposable Postgres, all six
fail at the same line:

    PrismaClientValidationError
    Invalid `this.prisma.product.findUnique()` invocation
      include: { productIngredients: ... }
                 ~~~~~~~~~~~~~~~~~~

`prisma/schema.prisma`, written in phase 02, names the relation `ingredients`.
`product.repository.ts`, written later, asks for `productIngredients` — in
`findById`, in `listWithIngredients`, in its `where` clause. Every query in the file.

TypeScript would have caught this on the first keystroke. It did not, and the reason
is the *other* defect:

1. the plan never commissioned `prisma.service.ts`
2. so `import { PrismaService } from '../prisma.service.js'` fails — `TS2307`
3. so `this.prisma` has an error type
4. so the compiler never validates the shape of a query made through it
5. so a relation that does not exist passes the typecheck
6. and only a live database refuses

One uncommissioned file hid a wrong relation name in every query of a repository. The
six-error typecheck was not a nearly-passing run; it was a run whose errors were
suppressing each other.

That is the same masking mechanism as problem 03 — where 25 unresolved imports stopped
the compiler from checking the calls behind them — and it is the second time the visible
error count has understated a run. **An error that prevents type information from being
computed is not one error. It is a hole of unknown size.**

## The database earned its place in the harness

This is the argument for `SECOND-PASS.md` §8, and it is stronger than when it was
written. The test step reported `ran: false` here, which reads as an absent measurement;
the measurement, once taken, was six of six failing on a defect neither the typecheck nor
a mock-based suite would have found. Runs that write the more thorough kind of test are
exactly the ones currently going unmeasured.

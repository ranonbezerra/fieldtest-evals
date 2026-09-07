# Verdict — 07 Versioned classification engine (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ~, M6 ✓]

graded:       {schema_design: 1, rule_semantics: 2, confidence_model: 2, tests: 0,
               quality: 2, process: n/a}

typecheck:    failed — 153 errors, most of them cascade from an ungenerated client
tests:        did not run

failure_mode: wrong_answer
              # `prisma generate` exits 1: `Rule.ingredient` and
              # `ProfileModifier.ingredient` both point at `Ingredient`, which
              # declares neither back-relation. No client, so every model property
              # in the codebase is unknown to the compiler.

revisions:    {self_repairs: 2, dropped_a_requirement: no}
cost:         {wall_minutes: —, output_tokens: —, requests: 3, usd: —}
host:         {n/a — the model is not on this machine}

harness_note: |
  This run's original gate result was contaminated. A repair round answered
  "I need to see the current file to understand what's there." followed by a
  `<tool_call>` block, and ft-run wrote that reply over a valid 319-line test file,
  after which tsc parsed prose and reported TS1434/TS1161/TS1005 — syntax errors that
  were the harness's, not the model's. The file has been restored from the transcript,
  ft-run now refuses to write an unfenced reply over a source file, and the 153 errors
  above are from a fresh typecheck of what the model actually delivered.

would_merge:  no
headline:     A carefully versioned design that cannot be built, because two relation
              fields point at a model that never learned it was pointed at.

notes: |
  The design work is real. M1 `MethodologyVersion` is commented `Immutable once
  published: the API offers no mutation for ACTIVE versions`, and rules hang off a
  version with `@@unique([methodologyVersionId, ingredientId])`. M2 every
  `ClassificationResult` stores its `methodologyVersionId`, so a historical result
  stays reproducible when the methodology moves on. M3 `status: 'flagged' | 'clear' |
  'unknown'` is a first-class third state, and `recognized` is counted separately for
  confidence — unknown is not silently safe. M6 normalization is its own module,
  `src/ingredients/normalize.ts`, with synonyms resolved through it.
  M5 is partial: profile modifiers exist and are modeled, but nothing in the service
  fixes their composition order, so layering two modifiers is not deterministic by
  construction.
```

## Five words missing from one model

    model Ingredient {
      id        String    @id @default(uuid())
      name      String    @unique
      createdAt DateTime  @default(now())

      synonyms Synonym[]        // ← present
                               // ← rules            Rule[]             missing
                               // ← profileModifiers ProfileModifier[]  missing

      @@map("ingredients")
    }

`Synonym` is declared at line 35, twelve lines below `Ingredient`. `Rule` is at 60 and
`ProfileModifier` at 96. **The back-relation the model anticipated is the one for the
model it wrote next. The two it forgot are for models it wrote much later.**

Prisma rejects the schema, `@prisma/client` exports nothing, and 153 errors follow —
of which the great majority are `Property 'x' does not exist` on a client that does
not exist. The error count says nothing about the code.

## This is not a one-off: it is one in three of this model's schemas

| hosted run | `prisma generate` | why |
|---|---|---|
| 01, 02, 05, 06, 11, 17 | 0 | — |
| 03 read-model projection | **1** | 5 validation errors |
| 07 this run | **1** | 2 validation errors |
| 12 orm migration | **1** | — |

Problem 03 is the same defect at larger scale. `Company`, `Event` and `Worker` are
declared first and carry **no back-relations at all**; `PaymentOrder`,
`OperationReadModel` and `CompanyOrderTotals` are declared 30 to 80 lines later and
point at them. Five errors, one cause.

The mechanism is consistent across both schemas: **the model writes each model
complete at the moment it writes it, and never goes back to amend an earlier one when
a later one references it.** Prisma is one of the few languages that requires exactly
that amendment.

This is `reference_gap` again, and this time it is not the decomposition. It happens
inside a single file in a single reply. The phased campaign showed the model losing a
reference across eighteen requests; here it loses one across seventy lines.

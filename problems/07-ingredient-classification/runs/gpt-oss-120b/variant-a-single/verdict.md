# Verdict — 07 Versioned classification engine (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ~, M2 ~, M3 ✗, M4 ~, M5 ✗, M6 ✗]

graded:       {schema_design: 2, rule_semantics: 0, confidence_model: 0, tests: 0,
               quality: 0, process: n/a}

typecheck:    failed after 10 repairs; `prisma generate` exits 1 on five one-sided
              relations, so most errors cascade from a client that was never built
tests:        did not run. The suite is one test named `should be defined`.

failure_mode: dropped_a_requirement
              # The classification engine does not exist. `ClassificationService`
              # is 28 lines whose only method is
              # `return this.repository.classify(productId, profileId)` — and the
              # repository has no `classify`.

revisions:    {self_repairs: 10, dropped_a_requirement: yes}
cost:         {wall_minutes: ~5, requests: 11, usd: 0.0074}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     A well-modelled schema with an empty application on top of it, and a
              service that delegates the whole problem to a method nobody wrote.
```

## The schema is the only real work

    enum Severity
    model Ingredient      model Synonym            model MethodologyVersion
    model Rule            model Profile            model ProfileOverride
    model Product         model ProductIngredient  model ClassificationResult
    model ClassificationFinding

That is the right domain. `MethodologyVersion` carries the rules; `ClassificationResult`
references it, which is what M1 and M2 need structurally; `ClassificationFinding` with
a `Severity` enum is M4's shape; `Synonym` is where M6's normalization would live;
`ProfileOverride` is M5's.

None of it is invalid as design, and all of it is invalid as Prisma:

    Error validating field `methodologyVersion` in model `ClassificationResult`: …
    Error validating field `ingredient` in model `ClassificationFinding`: …
    Validation Error Count: 5

Five one-sided relations. Same defect as problem 06 in this campaign and problems 03
and 07 in the 27B's.

## Above the schema there is nothing

`src/classification/classification.service.ts`, in full, is 28 lines:

    /**
     * NOTE: The actual classification logic lives in the repository; this service
     * merely coordinates the call …
     */
    async classify(productId: number, profileId?: number) {
      // Delegate to the repository – the repository is the only layer that
      // interacts with Prisma / the database.
      return this.repository.classify(productId, profileId);
    }

`ClassificationRepository` defines `getProductWithIngredients`, `getActiveRules`,
`getProfileModifiers`, `upsertClassificationResult` and `getClassificationResult`. It
does not define `classify`. Four of those five carry `// Placeholder implementation`.

So the service says the logic is in the repository, the repository says its methods are
placeholders, and the method the service calls does not exist. **The rule engine, the
confidence model, the unknown-ingredient handling and the profile layering — the four
things the problem is about — are written in no file.**

M3 is the clearest: the word `unknown` does not appear in `src`. "Unrecognized
ingredients surface explicitly as unknown and affect confidence" has no attempt.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (hosted) | gpt-oss-120b |
|---|---|---|
| files | 20 | 9 |
| must-haves | 5 of 6, M5 partial | 0 clean, 3 partial from the schema alone |
| normalization module | `src/ingredients/normalize.ts` | none |
| unknown as a third state | `'flagged' \| 'clear' \| 'unknown'` | absent |
| `prisma generate` | 1 — two one-sided relations | 1 — five |
| the engine | written | absent |
| cost | $— | $0.0074, 11 requests |
| verdict | FAIL | FAIL |

Both fail, and the distance between them is large. The 27B built a versioned engine
with an explicit unknown state and a normalization pass, and lost on a schema Prisma
rejected. The 120B produced the schema, the module wiring, the DTOs, the controller —
everything around the problem — and then delegated the problem itself to a method it
never wrote.

Seven problems in, this is the pattern's clearest case: **the 120B reliably produces
the shape of a solution and does not fill it.**

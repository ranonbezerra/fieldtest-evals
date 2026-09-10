# Verdict — 04 Grounded LLM product (qwen3.8-27b, hosted, **ladder**)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               upstream_provider: Parasail (retry); Venice errored the first attempt}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {judge_prompt: 3, grounding_mechanics: 3, harness_ergonomics: 2,
               failure_coverage: 3, quality: 1, process: n/a}

typecheck:    failed after 14 repairs — 27 errors, 13 of them in the two test files
tests:        did not run — the suite does not compile

failure_mode: reference_gap
              # Three `// ASSUMPTION` lines at the top of `assistant.service.ts`
              # describe what its three sibling modules export. Two are right. The
              # third gives `redactForHint(answer: string, sources: string[])`; the
              # function, in the same reply, is
              # `redactForHint(sentences: GroundedSentence[], playerQuestion: string)`.

revisions:    {self_repairs: 14, dropped_a_requirement: no}
cost:         {output_tokens: 11054 + 60272, requests: 16, usd: 0.3422}
host:         {n/a — the model is not on this machine}

verification: the redaction was run directly by the judge against a sentence carrying
              a boss name, a location and a quantity.

would_merge:  no
headline:     Six of six, including the redactor that defeated gpt-oss — and a service
              that calls its own redactor with the wrong arguments.
```

## Six of six, and M6 verified by running it

M6 is the requirement this problem exists for and the one gpt-oss got catastrophically
wrong: its redactor's condition was inverted and it returned the sentence unchanged.
This one was run directly:

    in:  The Gravel Wretch guards the cellar behind the bakery. You need 4 shards to open it.
    out: [REDACTED] guards the cellar [REDACTED]. You need [REDACTED] to open it.

Boss name, location and quantity all gone. Three separate rules, and the quantity rule
honours the exception the issue specified — `if (playerQuestion.includes(match)) return
match`, so a number the player already used survives.

M1 `faithfulnessJudge(answer: string, sources: string[])` — the judge takes the sources,
which is the whole point of §3 of the issue. M2 is literal in two places:
`Math.min(helpfulness.score, faithfulness.score)`. M3 splits sentences and filters on
`isSentenceGrounded`, with a `detectQuantityErrors` pass beside it. M4 the golden
scenarios carry `plantedFalseFacts`. M5 returns `'not covered by my sources'`.

Ten files, cleanly separated: grounding, redaction, llm-client, judges, harness, golden
scenarios, two test files.

## And the service calls its own redactor wrongly

`assistant.service.ts` opens with three assumptions about its siblings:

    // ASSUMPTION: './assistant.grounding' exports `isSentenceGrounded(sentence, sources)`
    // ASSUMPTION: './assistant.llm-client' exports `LlmClient` …
    // ASSUMPTION: './assistant.redaction' exports `redactForHint(answer: string, sources: string[])`

The first is correct — `assistant.grounding.ts` line 123 exports exactly that. The
third is not. `assistant.redaction.ts` line 13:

    export function redactForHint(
      sentences: GroundedSentence[],
      playerQuestion: string,
    ): string

Different parameter types, different second argument, different meaning. The model
described its own module and got it wrong, in a file it wrote minutes earlier.

**This is the sixth `ASSUMPTION` against a self-authored file recorded in this
repository and the third that was wrong.** The habit is not the defect — hedging when
you are unsure is right. The defect is hedging about something you wrote and did not
re-read.

Twenty-seven errors, thirteen of them in the two test files.

## The ladder axis, three problems in

| | 01 | 03 | 04 |
|---|---|---|---|
| must-haves met | **8 of 8** | 4 of 6 | **6 of 6** |
| the `model` axis's miss | M3 — fixed | M1 — fixed | — (it had 6 of 6 too) |
| what fails the build | repository vs its own schema | service vs its own service | service vs its own module |
| errors | 25 | 10 | 27 |

Three for three: **the design is built and the build is broken by the model
contradicting itself about an interface it authored.**

Problem 04 is the sharpest of the three, because the `model` axis also scored six of
six here and its failure was one capital letter in a test assertion. The specification
did not need to fix the design on this problem — and the drift showed up anyway, in a
different place.

That is the finding hardening: **the drift is not a symptom of having to design. It is
independent of it.**

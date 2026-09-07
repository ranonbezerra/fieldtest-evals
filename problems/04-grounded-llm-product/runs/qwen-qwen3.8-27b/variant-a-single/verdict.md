# Verdict — 04 Grounded LLM product (hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {judge_prompt: 2, grounding_mechanics: 3, harness_ergonomics: 2,
               failure_coverage: 3, quality: 2, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        16 of 17 pass

failure_mode: none
              # The one red test is the model's own assertion contradicting the
              # model's own capitalization, written in the same reply.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 13.6, output_tokens: —, requests: 1, usd: 0.182}
host:         {n/a — the model is not on this machine}

would_merge:  after two one-line fixes
headline:     The best run of the campaign: eleven files, one request, clean compile,
              and every must-have met — undone only by a test that disagrees with the
              code beside it about a capital letter.

notes: |
  All eleven files are the model's, tests included. `tsc --noEmit (attempt 0) -> 0`:
  the whole thing compiled on the first try, which nothing else in either campaign
  has done.
  M1 the faithfulness judge takes `sources: string[]` and scores the fraction of
  factual atoms they support. M2 is literal: `const finalScore = Math.min(helpfulness,
  faithfulness)`. M3 assesses sentence by sentence, decomposed into checkable atoms.
  M4 plants false facts in five scenarios — `'moonlight shard'`, `'rusted key'`,
  `'five shards'`, `'gravel wretch'`, `'bakery'`, `'four shards'` — so a confident lie
  and a wrong quantity are both scored. M5 has a dedicated module with one exact
  message. M6 is the requirement most runs fake, and this one honours it in the
  comment and in the code: the hint is derived from the already-grounded full answer
  by lexical redaction, `it never issues a second LLM call`.
```

## The failing test is a capital letter

The redaction is correct. Given

    Weaken the Gravel Wretch with a shard of glass. Four shards are required…

it returns

    Weaken the the hidden name with a shard of glass. Several shards are required…

`Four shards` → `Several shards`. That is the behaviour the brief asks for. The
assertion is

    expect(result.text).toContain('several shards');

and line 95 of the redactor is

    capitalizeFirst(redactQuantities(redactNames(redactLocations(sentence)), playerKnown))

The model wrote the capitalization and then, in the same reply, wrote an assertion
that the output is lowercase. **Nothing external caused this.** No decomposition, no
ceiling, no lost context — one file contradicting another file it was writing at the
same moment.

This is the campaign's finding at its smallest and clearest. Problem 02 hosted showed
the disagreement survives a single request; here it is one word wide, inside a run
that is otherwise the strongest work either condition produced.

## And the bug its tests do not catch

    Weaken the the hidden name with a shard of glass.
                ↑↑

`redactNames` slices `before = "Weaken the "`, tests `precededByArticle` — true —
and then emits `${before}the ${NAME_PLACEHOLDER}`, keeping the article it just
detected and adding another. It looks for the article precisely so it can choose
`the` over `a`, then forgets to drop it.

`expect(result.text).toContain('the hidden name')` passes on the doubled string. A
red suite hid a genuine defect in user-facing text; a green one would have hidden it
just as well. **Sixteen passing tests are not sixteen checks on what matters.**

## Against the local run of the same problem

| | local, phased | hosted, single |
|---|---|---|
| must-haves | 6 of 6 | 6 of 6 |
| typecheck | after 4 repairs | **attempt 0, no repairs** |
| tests | 12 of 15 | 16 of 17 |
| wall clock | 2 h 23 min | **13.6 min** |
| cost | a laptop's evening | $0.18 |
| verdict | PASS_WITH_NOTES | PASS_WITH_NOTES |

Same verdict, same gate, tenfold difference in effort. Problem 04 is a problem this
model does — and it does it better when asked all at once, because there is nothing
here it needed to hold across eighteen separate requests.

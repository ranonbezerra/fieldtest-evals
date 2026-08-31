```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {judge_design: 2, grounding: 3, eval_honesty: 1, refusal: 2,
               quality: 3, process: 3}

failure_mode: none
              — one of four test files hit the ceiling; its retry produced a
                complete file

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 214, output_tokens: 88134, tokens_per_second: 9.4,
               output_ceiling_hits: [answer.test.ts]}
host:         {pressure_samples: 0, comparable: yes}
gate:         {ran: true, passed: true, scaffold: [package.json, tsconfig.json]}

would_merge:  after_changes
headline:     First run whose code compiles, and it holds all six must-haves — then builds a judge that scores a correct refusal zero
notes: |
  **The first run in this campaign whose code compiles.** `tsc --noEmit` clean, no
  revisions needed. Problems 01 and 02 both shipped TypeScript that does not build;
  this one does.

  Every must-have holds, and two of them are held well rather than nominally:

  - **M2** is literally `score: Math.min(helpfulness, faithfulness)`. A confident
    unfaithful answer cannot average its way to a pass.
  - **M6** is the one most runs get wrong. The hint mode is `redactToHint(grounded,
    config)` — it takes the *already grounded full answer* and redacts tokens from
    it. It is derived by constraint, not produced by a second prompt, which is
    exactly what the must-have distinguishes.
  - **M3** splits sentences and gates each one against source tokens individually.
  - **M4** carries `plantedFalseFacts` through the scenario into
    `judgeFaithfulness`, and asserting one fails the scenario.

  **The defect is in the judge, and it is the mirror image of the one this problem
  was built from.** In `judgeFaithfulness`:

      const grounded = groundAnswer(answerText, sources);
      if (grounded.refused) return 0;

  A refusal scores zero on faithfulness. But a refusal asserts nothing, so it is
  maximally faithful — and M5 requires the service to refuse when the sources do
  not contain the answer. Combined with `min(helpful, faithful)`, **a scenario
  whose correct behaviour is refusal can never score above zero.** There is no
  `expectsRefusal` field on `Scenario` and no branch that treats it as success.

  The original incident behind this problem was a judge that rewarded confident
  hallucination. This one punishes correct refusal. Both are judges that push the
  service away from the behaviour the product needs, and a team optimising against
  this eval would learn to answer when it should decline.

  Scored 1 on eval_honesty for that. It does not fail M5 — the *service* refuses
  correctly — but it makes the eval unable to reward it.

  Probe next: variant B or C, to see whether the judge defect is specific to this
  framing. This is also the first run worth running the deliverable's own tests on,
  since it is the first that compiles.
```

---

**Judged by the operator against the rubric, not blind.** The typecheck is
machine-produced; the must-have reading is not. Re-judge with `harness/ft-anon`.

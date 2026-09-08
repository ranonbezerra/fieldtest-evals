# Verdict — 13 Legacy characterization tests (gpt-oss-120b, hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ~]

graded:       {input_space: 3, pinning_discipline: 3, findings_quality: 3,
               determinism: 3, quality: 3, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        61 of 61 pass, against the real `feeCalculator.ts`

failure_mode: none
              # The only reservation is an overclaim: "The current implementation is
              # fully characterized by the test suite", with no open questions listed.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: ~1, requests: 1, usd: 0.0008}
host:         {n/a — the model is not on this machine}

would_merge:  yes
headline:     Sixty-one green tests pinning the legacy calculator as it actually
              behaves, four planted quirks found and one more besides, every fix
              proposed and none applied — in one request.
```

## It characterized the real thing

    import { calculateFee, FeeBreakdown, CaseInput } from '../feeCalculator';

`feeCalculator.ts` is byte-identical to the fixture. M1 holds in substance, not just
in letter: the production code is untouched *and* it is the thing under test.

Two files delivered — the spec and `FINDINGS.md`. Nothing else invented.

## Every planted quirk, and the discipline the problem measures

| answer key | the model's finding |
|---|---|
| 1. Rate-table boundary asymmetry — second transition uses `>` where `>=` belongs. **The genuine bug.** | **§1 Table-revision boundary bug**, with `Proposed fix (not applied): Change the condition to if (openedAt >= REVISION_2022)` |
| 2. Rounding per component then summed | §2 Urgency calculation rounding |
| 3. Unknown case type falls through to the cheapest band silently | §4 Unknown case type defaults to STANDARD |
| 4. `complexity = 0` treated as band 1, `null` throws | §5 Complexity handling edge cases |
| (timezone item) | §6 Days-between calculation uses UTC date arithmetic |
| — | §3 Expedited fee includes urgency fee |

Four for four, plus one the key does not list.

**`Proposed fix (not applied)`** is the whole task. The problem is built to see whether
a model asked to characterize legacy code will instead correct it. This one names the
bug, states the fix, and pins the buggy output. `pinning_discipline: 3`.

M3's coverage is real: five describes over table-selection boundaries, band lookup,
urgency, expedited, and edge cases, at 61 assertions. M4 is satisfied by construction —
`calculateFee` takes its dates as inputs, so no clock is involved and no fake one is
needed.

## The note

`FINDINGS.md` closes:

    **Summary**: The current implementation is fully characterized by the test suite.

M6 asks that behaviour which could not be safely determined be listed as an open
question. Nothing is listed, and "fully characterized" is a stronger claim than 61
tests over a 131-line procedural function can support — the interaction of the
expedited and urgency percentages across all three rate tables, for one, is asserted
rather than explored. The finding quality is high enough that this reads as confidence
rather than carelessness, but it is the one place the report does not hedge where it
should.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (blind) | gpt-oss-120b (fixture visible) |
|---|---|---|
| module under test | **one it invented** — `criminal`/`civil` case types absent from the fixture | the fixture's own |
| tests | 15 of 53 pass | **61 of 61** |
| planted quirks found | 0 | **4 of 4, plus one** |
| findings report | six confident findings about fiction | six findings, each with a reproducing input |
| fixes | n/a | proposed, not applied |
| verdict | FAIL | **PASS_WITH_NOTES** |

This is the cleanest demonstration in either campaign of what the blindness cost. Qwen
was handed a prose description of a fee calculator, invented one with `criminal` and
`civil` case types the fixture does not contain, and wrote a detailed archaeology of
its own invention. Given the same task with the file in the prompt, this model read it
and found every planted quirk.

**Third consecutive result on a fixture problem for this model, after seven greenfield
failures: FAIL, PASS_WITH_NOTES, PASS, FAIL, PASS_WITH_NOTES.** It reads code well and
writes it from nothing badly.

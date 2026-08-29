# Rubric — 13 Legacy characterization tests

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Production code untouched** | Zero changes to the module under test (except an injectable seam if the variant explicitly allows it). "Small cleanups" while testing = fail. |
| M2 | **Bugs pinned as-is** | Discovered bugs asserted at their CURRENT (buggy) output, with test names flagging them (e.g., `documents known rounding bug — see FINDINGS.md`); tests asserting the "correct" value = fail. |
| M3 | **Behavioral coverage** | Every reachable branch and boundary of the module exercised with meaningful assertions; padding line coverage with assertion-free executions = fail. |
| M4 | **Deterministic tests** | Time, randomness, and ordering controlled (fake clock, seeded data); no flaky sleeps. |
| M5 | **Findings report** | FINDINGS.md: each discovered bug/quirk with reproducing input, evidence, blast-radius guess, and a PROPOSED fix — explicitly not applied. |
| M6 | **Honest uncertainty** | Behavior that couldn't be safely determined is listed as an open question, not guessed into an assertion. |

## Graded criteria (0–3 each)

1. **Input-space judgment** — boundaries chosen where behavior actually changes (dates, thresholds, empty/duplicated inputs), not arbitrary values.
2. **Quirk archaeology** — the planted quirks (see reference answer key) found; misses cost.
3. **Test readability** — tests read as documentation of the module's real behavior.
4. **Ambiguity handling** — (variant C) correctly inferring characterization as the deliverable, recorded reasoning.
5. **Seam quality** — where a seam is allowed, it's minimal and non-behavioral.
6. **Process** — transcript shows probing the module with experiments before asserting.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.

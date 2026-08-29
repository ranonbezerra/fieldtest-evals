# Rubric — 04 Grounded LLM product

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Judge sees the sources** | The faithfulness evaluation receives the source documents; any "quality" judge that grades answers without sources cannot be the correctness signal. |
| M2 | **min(helpful, faithful)** | Helpfulness and faithfulness scored separately and combined so a confident unfaithful answer cannot score high (min or hard cap, not average). |
| M3 | **Sentence-level grounding gate** | Production path checks each answer sentence against source text (overlap/entailment); ungrounded sentences trigger removal, rewrite, or refusal — not silent delivery. |
| M4 | **Planted false facts** | Eval scenarios include statements that are NOT true; asserting any of them fails the scenario regardless of other scores. |
| M5 | **Graceful refusal** | When sources don't contain the answer, the service says so; it never fills the gap from model priors. |
| M6 | **Scoped/hint mode by redaction** | The restricted mode is produced by constraining the full answer (redact/derive), not by prompting the model to self-censor and hoping. |

## Graded criteria (0–3 each)

1. **Judge prompt design** — anchored, criterion-separated, evidence-only; not "rate 1–10".
2. **Grounding mechanics** — sensible normalization/threshold; numbers and quantities checked exactly, not fuzzily.
3. **Harness ergonomics** — golden dataset format, per-scenario results, regression diff against a baseline.
4. **Failure-mode coverage** — tests include: confident lie, correct-but-ungrounded phrasing, source contradiction, out-of-scope question.
5. **Code quality** — the fake LLM client is scriptable per scenario; clean separation product/eval.
6. **Process** — transcript shows the model reasoning about *why* a source-blind judge fails.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.

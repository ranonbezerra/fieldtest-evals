# Rubric — 02 Reconciliation + safe resend

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Resend only after proven absence** | The only code path that re-sends starts from reconciliation confirming the payment is not in the bank's records. Resend from timeout/catch = fail. |
| M2 | **Deterministic external id** | External txid derived deterministically from stable order attributes; a duplicate send collides at the provider instead of paying twice. Random UUID per attempt = fail. |
| M3 | **Bounded attempts → terminal review** | Max attempts enforced; exhaustion parks the order in a manual-review state that no automated path leaves. |
| M4 | **Never revert in uncertainty** | No path releases/refunds funds while provider outcome is unknown. |
| M5 | **Response classification** | Provider responses mapped to explicit buckets with distinct handling; "duplicate/already exists" treated as success-equivalent, not error. |
| M6 | **Reconcile is rerunnable** | Running reconciliation twice over the same statement window changes nothing (idempotent matching, no double state transitions). |

## Graded criteria (0–3 each)

1. **State machine** — explicit statuses; the resend-eligible state is distinct and only reachable via reconcile.
2. **Matching logic** — statement↔order matching keyed on the deterministic id; partial/late settlement handled.
3. **Time-window reasoning** — reconcile handles "not visible yet" vs "absent" (e.g., grace period before declaring absence).
4. **Tests** — cover: timeout-then-actually-settled (must NOT resend), proven-absent (must resend with same txid), exhaustion path.
5. **Code quality** — readable, idiomatic, sane schema.
6. **Process** — transcript shows the model probing the ambiguity (asks or documents assumptions about statement latency).

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.

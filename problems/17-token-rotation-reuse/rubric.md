# Rubric — 17 Refresh-token rotation with reuse detection

## Gate: must-haves (missing any = FAIL, regardless of tests)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Rotation retires the old token atomically** | Consuming a token and issuing its successor happen in one transaction, and the old token cannot be consumed twice. |
| M2 | **Race-safe consume** | Two concurrent presentations of the same valid token result in exactly one rotation. A conditional `UPDATE … WHERE status = 'active'` (checking rows affected), a row lock, or a unique constraint on the successor. A read-then-write in application code = ✗. |
| M3 | **Reuse tears down the family** | Presenting a consumed token invalidates **every** token descended from the same original issue, not just the one presented. The family identity is persisted, not reconstructed by walking a chain at detection time. |
| M4 | **Reuse is checked before expiry** | A token that is both consumed and expired is treated as **reuse**. Rejecting it as expired first means a replayed stolen token never raises the alarm — and that is the whole mechanism. |
| M5 | **Absolute deadline is inherited** | The family carries a deadline fixed at first issue. Rotation never extends it. A refresh that resets the clock = ✗. |
| M6 | **Rejections are indistinguishable to the caller** | Expired, reused, unknown and malformed all produce the same status, the same body and no distinguishing header. The audit record distinguishes them fully. |
| M7 | **One deterministic source for the token** | Body and cookie are both accepted, precedence is defined and documented, and presenting both does not change which is used. |
| M8 | **Tests prove the properties, not the paths** | At minimum: a genuinely concurrent consume; a replay that kills a *sibling* token; a rotation that does not extend the deadline; and the two rejection bodies compared byte-for-byte. |

## Graded criteria (0–3 each, judged blind against the reference)

1. **State machine** — token states and transitions are explicit; no state is
   reachable from an unsafe predecessor.
2. **Family modelling** — how descent is represented, and whether teardown is one
   statement or a traversal that can be interrupted halfway.
3. **Concurrency** — the mechanism chosen for M2, and whether the test actually
   races rather than calling twice in sequence.
4. **Audit** — the record names the account and the family, and would let someone
   reconstruct the incident. An audit row for a stolen session that does not name
   the account is a real defect found this way.
5. **Tests** — the concurrent case especially. A test that awaits two calls in
   order is not a concurrency test.
6. **Process** (from transcript) — did it enumerate the decisions before writing,
   or discover them one compile error at a time?

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries M1..M8; `graded` carries the six criteria above.

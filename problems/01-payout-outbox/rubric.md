# Rubric — 01 Payout with outbox + hold

## Gate: must-haves (missing any = FAIL, regardless of tests)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Hold, not debit** | Creation reserves funds (hold/held column or hold entity). Gross balance is untouched at creation; available = balance − held. |
| M2 | **Race-safe reservation** | Check + reserve is one atomic act (conditional `UPDATE ... WHERE balance - held >= amount` or equivalent row lock). A `SELECT` then `UPDATE` in app code without locking = fail. |
| M3 | **Outbox in the same transaction** | The message/event row is inserted inside the same DB transaction that creates the payout. Enqueue-after-commit or enqueue-before-commit = fail. |
| M4 | **Consumer dedup** | Worker is safe under redelivery: dedup by message id (processed-messages table, unique constraint, or status transition guard). |
| M5 | **Creation idempotency** | Idempotency key on the create endpoint; a retried request returns the existing payout and does not reserve twice. |
| M6 | **Settlement only on confirmation** | Ledger settlement entry + hold capture happen only when the external transfer is confirmed; hold release on definitive failure. |
| M7 | **No revert in uncertainty** | Retry with a bound; on exhaustion, park in a terminal review state. Auto-release/auto-refund when the provider outcome is unknown = fail. |
| M8 | **Money is integer** | Minor units as integer/BigInt end to end. Floats anywhere in the money path = fail. BigInt JSON serialization handled. |

## Graded criteria (0–3 each, judged blind against the reference)

1. **State machine clarity** — payout states are explicit, transitions are guarded,
   no state is reachable from an unsafe predecessor.
2. **Transaction boundaries** — each transaction contains exactly what must be
   atomic, and nothing that must not be (no external HTTP inside a DB transaction).
3. **Error taxonomy** — provider responses classified (accepted / duplicate /
   transient / permanent) with different handling per class, not a single catch-all.
4. **Tests** — cover the race (concurrent creates), the duplicate delivery, and the
   retry-exhaustion path; not just the happy path.
5. **Code quality** — readable, idiomatic NestJS/Prisma, sane schema and migration.
6. **Process** (from transcript) — did the model read the schema/constraints before
   writing? Were self-corrections converging or thrashing?

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
For this problem, `gate` carries M1..M8 and `graded` carries:

```
{state_machine: n, tx_boundaries: n, errors: n, tests: n, quality: n, process: n}
```

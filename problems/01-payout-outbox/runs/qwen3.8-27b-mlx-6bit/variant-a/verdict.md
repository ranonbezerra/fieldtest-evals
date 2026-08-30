```yaml
verdict:      FAIL
condition:    {runner: api, spec: model}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 wrong,
               M6 decided, M7 decided, M8 decided]
gate:         [M1 ✓, M2 ✗, M3 ✓, M4 ✗, M5 ✗, M6 ✓, M7 ✓, M8 ✓]

graded:       {state_machine: 3, tx_boundaries: 2, errors: 2, tests: 1,
               quality: 2, process: 2}

failure_mode: wrong_answer
              — three phases hit the ceiling and were retried without reasoning;
                the retries produced complete files, so the defects below are the
                model's design and not truncation artifacts

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 304, output_tokens: 109075, tokens_per_second: 6.8,
               output_ceiling_hits: [payout.repository.ts, payout.service.ts,
                                     payout.spec.ts]}
host:         {pressure_samples: 1 of 12, ceiling_gib: [37.44, 37.44],
               comparable: no}

would_merge:  no
headline:     Builds the whole shape correctly, then invents a Prisma locking API that does not exist — the one requirement that had to be atomic
notes: |
  Structurally this is a competent payout service. The hold is modelled correctly
  (settled_balance untouched at creation, reserved_amount incremented, available =
  settled − reserved), the outbox row is written inside the creation transaction,
  settlement captures the hold only on provider confirmation, and NEEDS_REVIEW
  deliberately does not release the reservation. BigInt end to end. It reads like
  code someone thought about.

  It fails on the hardest requirement, and it fails in the most instructive way
  available: it INVENTED an API that looks exactly like the right answer.

      const account = await tx.account.findUnique({
        where: { id: input.accountId },
        lock: { mode: 'FOR UPDATE' },          // ← no such Prisma option exists
      });

  Prisma has no `lock` parameter; row locking requires $queryRaw with SELECT ...
  FOR UPDATE, and there are zero raw queries in the file. So what is actually
  there is findUnique → compare → update inside a transaction, which at READ
  COMMITTED does not stop two concurrent payouts overdrawing the account. That is
  the precise spurious solution M2 was written to catch, dressed as the fix.

  M4 falls with it: claimMessage() relies on `lock: { mode: 'FOR UPDATE SKIP
  LOCKED' }`, the same invention, so the dedup guard is not atomic either.

  M5 is a contract miss rather than a safety one. The unique index on
  (account_id, idempotency_key) does prevent a second payout, but a retried
  request throws DuplicatePayoutError where the statement asks for the existing
  payout to be returned.

  Nothing caught the invented API because the workspace has no tsconfig.json — the
  model's manifest declared ten files and no build configuration, so the gate
  could not run. A typecheck would have failed on `lock` immediately.

  Probe next: the ladder (--spec ladder). The plan decided seven of eight
  must-haves correctly, so this may be an implementation failure rather than a
  design one — and if the reference's types are handed over, whether it still
  reaches for an API that does not exist is the question worth answering.
```

---

**Judged by the operator against the rubric, not blind.** This is the campaign's
first completed run and the verdict exists to prove the pipeline produces something
judgeable. It should be re-judged blind, with `harness/ft-anon`, before it is quoted.

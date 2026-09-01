# Verdict — 01 Payout with outbox + hold

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 wrong, M5 decided,
               M6 decided, M7 wrong, M8 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✗, M5 ✓, M6 ✓, M7 ✗, M8 ✓]

graded:       {state_machine: 2, tx_boundaries: 3, errors: 0, tests: n/a,
               quality: 3, process: 3}

failure_mode: wrong_answer
              # Not drift. PLAN.md contradicts itself, and the code implements the
              # concrete half. §3 Ordering rules:164 — "must use a conditional
              # update (WHERE status = 'pending') so two workers cannot claim".
              # §4 Control flow:190 — "UPDATE ... WHERE id=? AND status IN
              # ('pending','processing')". The code is a faithful transcription of
              # the second. Same for M7: §1 reasons "a human inspects before
              # releasing or confirming", §4:196 specifies releaseHold on
              # exhaustion, and §4 is what was built.

revisions:    {self_repairs: 0, dropped_a_requirement: yes}
cost:         {wall_minutes: 250, output_tokens: 146619, tokens_per_second: 9.8,
               output_ceiling_hits: [plan, payout.repository.ts,
                                     payout-worker.service.ts,
                                     payout.controller.ts, payout.spec.ts-cases]}
host:         {requests_under_pressure: 0 of 15, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     States the invariant in prose, then writes the SQL that breaks it two
              sections later, and builds the SQL.
notes: |
  The plan names the eight hard decisions and resolves each one. It also contradicts
  itself twice, and both contradictions are what the gate caught. The code is not
  unfaithful to the plan; it is faithful to the wrong half of it.
  M4: §3 requires the claim to match only `pending`, and says why — "so two workers
  cannot claim". §4 then writes the statement out as `status IN
  ('pending','processing')`, because the same flow feeds it stale PROCESSING rows to
  reclaim and nothing reconciled the two. The code copies §4. Under READ COMMITTED a
  second worker re-evaluates the WHERE after the first commits, still matches, and
  also returns count === 1. Both send the payout.
  M7: §1 reasons its way to the right principle — "a human inspects before releasing
  or confirming" — and §4 step 6 specifies `releaseHold` on exhaustion anyway, into
  a state its own diagram labels "outcome unknown". The code does what §4 says.
  What it got right is not the easy half. M2 is a real `SELECT ... FOR UPDATE` via
  $queryRaw inside the transaction, not an invented Prisma option. M5 carries both
  guards: pre-check and P2002 re-read of the winner. M8 is BigInt end to end with
  toString() only at the HTTP boundary.
  Criterion 3 scores 0 by the model's own decision, not by omission: the
  assumptions table chose to "treat all thrown errors as transient". The rubric
  asks for four classes; the model argued its way to one and implemented that
  faithfully.
  Tests are n/a, not 0: the case-enumeration phase hit the output ceiling when no
  retry existed for that phase, so test/payout.spec.ts was never written. Harness
  defect, since fixed. This run cannot speak to criterion 4.
```

## Open question this run raises

Three files were written at `reasoning_effort=low` after a ceiling hit
(`payout.repository.ts`, `payout-worker.service.ts`, `payout.controller.ts`), and
both lost must-haves live in the first two. That correlation is not clean enough to
call a finding: the same lowered repository file also carries M2, the hardest
correct thing in the run, and the plan itself was regenerated at `low` and is where
all eight decisions were made right. Effort is one candidate; drift between a long
plan and a later file that must honour it is another. The `medium` experiment is
the way to separate them.

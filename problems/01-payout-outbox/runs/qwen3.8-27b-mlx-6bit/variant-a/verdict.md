# Verdict — 01 Payout with outbox + hold

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided,
               M6 decided, M7 decided, M8 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✗, M5 ✓, M6 ✓, M7 ✗, M8 ✓]

graded:       {state_machine: 2, tx_boundaries: 3, errors: 0, tests: n/a,
               quality: 3, process: 3}

failure_mode: wrong_answer
              # Both lost must-haves were specified correctly in PLAN.md and
              # contradicted in the code. PLAN.md:164 — "claimMessage /
              # claimStaleMessages must use a conditional update (WHERE status =
              # 'pending') so two workers cannot claim" — became
              # `status: { in: [PENDING, PROCESSING] }`.

revisions:    {self_repairs: 0, dropped_a_requirement: yes}
cost:         {wall_minutes: 250, output_tokens: 146619, tokens_per_second: 9.8,
               output_ceiling_hits: [plan, payout.repository.ts,
                                     payout-worker.service.ts,
                                     payout.controller.ts, payout.spec.ts-cases]}
host:         {pressure_samples: 0 of 12, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Designs the whole thing correctly, then widens two guards in the code
              until they stop guarding.
notes: |
  The plan is the strongest artifact in this run. It names the eight hard
  decisions, resolves each one, and justifies them. Every must-have was decided
  before a line was written.
  Two were then lost in implementation, both by widening a predicate the plan had
  narrowed. M4: the claim admits PROCESSING with no staleness test, so under READ
  COMMITTED a second worker re-evaluates the WHERE after the first commits, still
  matches, and also returns count === 1. Both send the payout.
  M7: the plan's own rationale reads "a human inspects before releasing or
  confirming"; the exhaustion branch calls releaseHold, un-reserving money whose
  provider outcome is unknown. It parks in NEEDS_REVIEW correctly and gives the
  funds back on the way there.
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

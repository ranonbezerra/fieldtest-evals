```yaml
verdict:      FAIL
condition:    {runner: api, spec: model}

plan_gate:    [M1 wrong, M2 decided, M3 decided, M4 decided, M5 wrong, M6 decided]
gate:         [M1 ✗, M2 ✓, M3 ✓, M4 ✓, M5 ✗, M6 ✓]

graded:       {state_machine: 2, tx_boundaries: 1, errors: 2, tests: 2,
               quality: 2, process: 2}

failure_mode: wrong_answer
              — three phases hit the ceiling; all three retries produced complete
                files, so the design below is the model's

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 409, output_tokens: 106584, tokens_per_second: 8.9,
               output_ceiling_hits: [repository.ts, read-model.spec.ts, drift-repair.spec.ts]}
host:         {pressure_samples: 0, comparable: yes}

would_merge:  no
headline:     Everything around the projection is right — the rebuild, the drift repair, the index — and the write itself is not transactional
notes: |
  The periphery is genuinely well done. `rederiveWindow` reconstructs a window from
  `paymentOrder` inside a transaction, deleting and recreating, so M2 holds and is
  idempotent. `drift-repair.processor.ts` runs a sliding window over recent data,
  so drift cannot sit silently — M3. The dashboard query touches
  `operationReadModel` and nothing else, verified by reading every table named in
  it — M4. And M6 is better than most: a composite
  `[companyId, status, occurredAt desc, id desc]` that matches a filtered, sorted,
  keyset-paginated dashboard rather than an index on every column.

  M1 is the requirement this problem is built around, and it is not met:

      const source = await this.prisma.paymentOrder.findUnique({ ... });
      if (source === null) throw new ResourceNotFoundError(...);
      await this.repo.upsert(input);

  Two independent statements, no transaction around them. The must-have asks for
  the projection upsert to happen in the same DB transaction as the source write,
  and here there is no source write at all — the source is read to validate that
  the order exists, and the projection is then written from `input`. A process that
  dies between the two lines leaves a projection that no longer matches anything,
  and nothing detects it until the next drift-repair tick.

  M5 falls out of the same shape. The upsert writes absolute values, not atomic
  increments, and the values come from the caller's `input` rather than from the
  `source` row it just read. Two concurrent upserts for one `orderId` race, last
  write wins, and the winner is not guaranteed to be the one that matches the
  source. The read is decorative: its only effect is a 404.

  So the transaction boundary is the whole problem and it is the one thing missing.
  Scored 1 on tx_boundaries for that reason; everything built on top of the
  projection is a 2 or better.

  Probe next: the ladder. Five of six must-haves are met, and the miss is one
  `$transaction` wrapper — this looks far more like an implementation gap than a
  design one, which is exactly what `--spec ladder` exists to distinguish.
```

---

**Judged by the operator against the rubric, not blind.** Re-judge with
`harness/ft-anon` before quoting.

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ~, M6 ✓]

graded:       {state_machine: 3, tx_boundaries: 2, errors: 2, tests: 2,
               quality: 1, process: 3}

failure_mode: wrong_answer
              — two phases hit the ceiling and both retries produced complete files,
                so what is here is the model's design, not truncation

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 106, output_tokens: 64168, tokens_per_second: 10.1,
               output_ceiling_hits: [payout.service.ts, payout.service.spec.ts]}
host:         {pressure_samples: 0, comparable: yes}

would_merge:  no
headline:     Gets every safety requirement right, including the subtle one — then ships TypeScript that does not compile
notes: |
  This is a markedly stronger run than problem 01, and it earns it on the
  requirement that is hardest to see.

  M1 asks that a resend only ever follow PROVEN absence. The reconciliation does
  not simply check whether a txid is in the statement — it first asks whether the
  statement is published at all:

      const isPublished = this.isStatementPublished(statement, window.to);
      if (!isPublished) continue;

  An unpublished statement cannot prove absence, so nothing moves. That is exactly
  the distinction the must-have exists for, and it is the one a plausible
  implementation skips.

  M2 is a sha256 of `${orderId}|${effectiveDate}` — deterministic from stable
  attributes, so a duplicate send collides at the provider rather than paying
  twice. M3 parks at MAX_ATTEMPTS in `manual_review`, and the reconcile loop only
  touches orders in `sent`, so nothing automated ever lifts it out. M4 has no
  release or refund path at all. M6 is rerunnable because settled orders are
  skipped on the next pass.

  M5 is marked ~: the four buckets exist and `duplicate` is correctly treated as
  success, but `classifyResponse` merely returns `response.classification` — it
  delegates the mapping to the bank client rather than performing it.

  What sinks would_merge is that **the code does not compile**. 25 errors, and the
  dominant class is mechanical: relative imports written without the `.js`
  extension that ESM requires and the cheatsheet declares. Under Node ESM that is
  ERR_MODULE_NOT_FOUND at boot, not a style note. Also `require("crypto")` inside
  an ESM module — `require` is not defined there — and several `unknown`/implicit
  `any` bindings under strict.

  So: the design is right and the artifact does not run. Quality scored 1 for that
  reason alone.

  **Two runs, two non-compiling deliverables**, both from the same cause: a
  convention the cheatsheet states plainly and the model does not follow. That is
  now a pattern rather than an incident.
```

---

**Judged by the operator against the rubric, not blind.** The typecheck evidence is
machine-produced; the must-have reading is not. Re-judge with `harness/ft-anon`
before quoting.

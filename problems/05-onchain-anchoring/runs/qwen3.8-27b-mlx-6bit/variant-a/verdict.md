# Verdict — 05 On-chain anchoring

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {state_machine: 3, recovery: 3, verification: 3, tests: 3,
               quality: 2, process: 3}

typecheck:    failed after 13 repairs — 17 errors, all TS2307
tests:        12 of 13 pass

failure_mode: reference_gap
              # Every one of the 17 remaining errors is a relative import missing the
              # `.js` extension that `"type": "module"` with NodeNext requires. One of
              # eighteen carries it. Nothing else fails to compile.

revisions:    {self_repairs: 13, dropped_a_requirement: no}
cost:         {wall_minutes: 174, output_tokens: 100054, tokens_per_second: 9.6,
               requests: 25, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 25, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  after_changes
headline:     The strongest work in the campaign, held out of the build by a missing
              file extension.

notes: |
  Six must-haves, six passes, and the best graded row so far. The only thing between
  this and a merge is seventeen import statements.
  M1 is explicit and correctly ordered — `// Persist the anchor intent BEFORE
  broadcasting`, then `repo.create()`, then `chain.broadcast()`. The race the problem
  is built on was identified without prompting.
  M4 is the reason the graded scores are high. A `BroadcastTimeoutError` leaves the
  row `pending` for the recovery sweep rather than marking it failed, and the sweep
  in `anchor-worker.service.ts` resolves both directions of the crash: a pending row
  the chain already has a receipt for becomes confirmed, a pending row with no
  receipt is re-broadcast. Both have tests, named as crashes.
  M5 canonicalizes recursively — object keys sorted at every depth, arrays left in
  order — before `sha256`, and tests that key insertion order does not change the
  hash and that any value change does.
  M6 puts the signer behind `ChainClient.prepare(contentHash)`, so no key material
  appears anywhere in the source.
  The one failing test is M2's error contract, not its invariant. The schema carries
  `@@unique([documentId, version])`, so two anchors cannot exist; what is missing is
  the P2002 translation into the `duplicate_anchor` code the test asserts, so a
  duplicate surfaces as a raw Prisma error instead. The guarantee holds; the API
  contract around it does not.
```

## Half the campaign's gates, one lexical convention

Running tally of relative imports carrying the `.js` extension that this scaffold
requires, at `reasoning_effort: medium`:

| run | with `.js` | typecheck |
|---|--:|---|
| 01 payout outbox | **26 of 26** | failed on other grounds |
| 03 read model projection | 2 of 13 | failed, 25 of 31 errors TS2307 |
| 04 grounded llm product | **22 of 22** | passed |
| 05 on-chain anchoring | 1 of 18 | failed, 17 of 17 errors TS2307 |

Two runs committed to the extension and held it across 26 and 22 imports. Two omitted
it and held *that* across 12 of 13 and 17 of 18. The convention is chosen once per run
and then kept — it is not, as problem 03 at `low` first suggested, re-decided every few
phases.

That makes it the single largest determinant of whether a run compiles, and it is
independent of the quality of the work underneath: this run has the best graded scores
in the campaign and the worst extension rate.

Thirteen repairs did not fix one of them. The repair phase is handed the compiler's
exact output, which names the modules it cannot find — and `Cannot find module
'./anchoring.service'` apparently does not read as *add an extension* to a model that
has already decided this project does not use them.

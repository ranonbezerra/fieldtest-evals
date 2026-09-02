# Verdict — 03 Read model projection

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✗, M2 ✗, M3 ✗, M4 ✓, M5 ✗, M6 ✓]

graded:       {schema_design: 2, rebuild_story: 1, tradeoffs: 2, tests: 3,
               quality: 1, process: 1}

typecheck:    failed after 2 rounds and 30 repairs — 31 errors, 25 of them TS2307
tests:        6 of 9 fail

failure_mode: reference_gap
              # The services call repository methods that were never implemented:
              # `this.repo.reDeriveWindow is not a function`, `this.repo.simulateWrite
              # is not a function`. TypeScript would have caught both — but 25 of the
              # 31 errors are unresolved relative imports missing the `.js` extension
              # ESM requires, so tsc never resolved the modules and never reached the
              # method calls. The compile errors masked the real defects, and 30
              # repairs across two rounds never touched the extensions.

revisions:    {self_repairs: 30, dropped_a_requirement: yes}
cost:         {wall_minutes: 462, output_tokens: 269975, tokens_per_second: 9.7,
               requests: 54, output_ceiling_hits: [17-operations.spec.ts (at low)]}
host:         {requests_under_pressure: 0 of 54, sampler_pressure: 3 of 21,
               ceiling_gib: [37.44, 37.44], comparable: yes}

would_merge:  no
headline:     Its compile errors hid its real ones, and thirty repairs fixed neither.

notes: |
  The most expensive run in the campaign — 7.7 hours, 270k tokens, more than
  problems 01 and 02 together — and the least of it survives.
  M1 is the point of the problem and there is no implementation. The brief asks for
  projections maintained by synchronous in-transaction hooks on every write. The
  source contains exactly one `$transaction`, inside the re-derivation service, and
  the write path is a method called `simulateWrite` that the repository never
  implements. Nothing updates a projection alongside a source write.
  M2 and M3 fail the same way: `reDeriveWindow` is called and not defined, and drift
  repair reports `expected 0 to be greater than 0` — it finds nothing to repair.
  What passes is what needed no cross-file agreement. M4 reads the projection alone,
  in one query with no join back to source. M6 indexes `[companyId, status,
  createdAt desc]` and `[companyId, createdAt desc]`, which match the dashboard's
  filters and sort.
  The tests score 3 and are the reason the failures are legible. Nine cases naming
  read-your-own-writes, concurrent totals, re-derive idempotence, drift detection and
  repair. Six fail, and each failure names a method that does not exist.
```

## The compile errors hid the real ones

The chain, in order:

1. Eleven of thirteen relative imports omit the `.js` extension that `"type": "module"`
   with `moduleResolution: NodeNext` requires.
2. `tsc` reports 25 × TS2307 and stops resolving those modules.
3. Because the modules never resolve, the compiler never typechecks the calls into
   them — `this.repo.reDeriveWindow` is never compared against the repository's
   interface.
4. Two repair rounds and thirty requests work on what the compiler *did* report and
   never on the extensions, so the resolution errors survive and the interface
   mismatches stay invisible.
5. The suite runs and finds them in ninety seconds: six failures, every one a
   `TypeError` for a missing method or an assertion that nothing happened.

A typecheck that cannot resolve a module is not a weaker typecheck — it is a silent
one, over exactly the surface where these phases disagree.

## Against problem 01, and a correction

Problem 01 at `medium` carried the `.js` extension on **26 of 26** relative imports, and
this run carries it on **2 of 13**, both in the same directory. On the strength of
problem 01 alone, FINDINGS §3.6 was updated to suggest `medium` had settled the
convention. At n=2 that does not hold: the drift is still there, still clusters by
directory, and is still the largest single cause of gate failure in the campaign.

What separates the two runs is not the setting. It is that problem 03 declares 19 files
across four modules and problem 01 declares 14 across two — more files, more
cross-references, more chances for a convention re-decided per request to diverge.

## What this adds to the second pass

[`SECOND-PASS.md`](../../../../SECOND-PASS.md) §2 proposes checking that every type in a
constructor signature resolves to a file the manifest declares. This run shows that is
too narrow. The failures here are **method-level**: the repository file exists, is
declared, and is imported — it simply does not have `reDeriveWindow` on it.

The check has to be that every method a later phase calls on an earlier phase's class
exists in the interface the plan gave that class. The plan carries those signatures; it
is the same document, read the same mechanical way, as §1 and §2 already argue for.

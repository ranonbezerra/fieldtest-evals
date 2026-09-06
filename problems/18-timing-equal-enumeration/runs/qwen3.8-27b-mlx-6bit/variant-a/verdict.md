# Verdict — 18 Timing-equal enumeration

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided,
               M6 decided, M7 decided]
gate:         [M1 ✗, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ~]

graded:       {equalisation: 2, response_parity: 3, timing_test: 3, leak_audit: 2,
               code_quality: 1, process: 2}

manifest:     11 declared, 11 built, not truncated
typecheck:    failed after 9 repairs — 17 errors, 15 of them TS2307
tests:        did not run. `Failed to load url @nestjs/testing`

failure_mode: wrong_answer
              # Both branches are equalised on `argon2.verify` and then the
              # new-account branch adds an unmatched `argon2.hash` — the same order of
              # cost again, on one side only. The equalisation is defeated four lines
              # after it is written.

revisions:    {self_repairs: 9, dropped_a_requirement: no}
cost:         {wall_minutes: 171, output_tokens: 104232, tokens_per_second: 10.1,
               requests: 23, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 23, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Equalises the expensive operation, then adds a second expensive
              operation to one branch, and writes the test that would have caught it.

notes: |
  M2 is right and it is the one most submissions get wrong. There is no
  `sleep(random())` anywhere. Equalisation is by doing the same work: a `dummyHash` is
  computed once at startup and the unknown-account branch verifies against it, so both
  paths pay one argon2 verify.
  Then `signUp` continues:

      const hashToCheck = existing ? existing.passwordHash : this.dummyHash;
      await argon2.verify(hashToCheck, password);          // equalised

      if (existing === null) {
        const realHash = await argon2.hash(password, ARGON2_PARAMS);   // not
        await this.repo.createUser(email, realHash);
        ...

  An argon2 hash costs what an argon2 verify costs. The new-account branch pays two,
  the existing-account branch pays one, and the signal the equalisation removed is put
  straight back — larger than before, since it is now a whole KDF rather than a
  database lookup. M1 fails on the function the problem is named after.
  M7 is `~` for the surrounding care, which is real: both branches write once to the
  repository and send exactly one email, with different templates. The shape was
  thought about. The KDF was not.
  M3 holds — both paths return `{ message: 'Check your email for next steps.' }`, and
  there is a test comparing the responses byte for byte rather than eyeballing them.
```

## It wrote the instrument that catches it

M4 asks for a timing test that can fail. M5 asks that the test be honest — samples,
distributions, not one pair of stopwatch readings. This is what it wrote:

```ts
const N = 30;
for (let i = 0; i < N; i++) {
  // …new-account request, timed…
  // …existing-account request, timed…
}
const medDiff = Math.abs(median(newTimes) - median(existingTimes));
const p95Diff = Math.abs(p95(newTimes)  - p95(existingTimes));
expect(medDiff).toBeLessThan(50);
expect(p95Diff).toBeLessThan(100);
```

Thirty samples per branch, **interleaved** so machine drift hits both equally, compared
on median *and* p95 with separate tolerances. That is a better timing test than most
production suites carry, and it scores 3 on its own.

It would also fail. An unmatched argon2 hash with the parameters this code uses costs
far more than the 50 ms median tolerance the test sets for itself. The model built the
defect and the detector in the same run, and the detector was right.

**It never ran.** `@nestjs/testing` is not in the harness scaffold, so
`test/auth.spec.ts` could not load — the fourth run in this campaign to lose its suite
to that package, after 06, 12 and 15. Here it costs the most: M4's entire deliverable
is a timing test that can fail, and the one thing that would have told the model its
equalisation was broken was prevented from executing by the environment.

## The seventh instance, and the last

| run | it stated the right thing in | and contradicted it in |
|---|---|---|
| 01 | the plan's ordering rules | the plan's control flow |
| 02 | the test suite | the implementation |
| 04 | the test suite | the pipeline the test measures |
| 09 | the tests' expected error codes | the implementation's codes |
| 15 | `DIAGNOSIS.md` | the module it then created |
| 17 | the repository's stored hash | the token the service returned |
| 18 | a 30-sample interleaved timing test | four lines above it |

Seven runs where one artifact of a run is right and another, from the same run,
disagrees. In five of the seven the artifact that was right is a test — which is the
practical conclusion of this campaign for anyone using this model: **run what it
writes, because what it writes is a better judge of its code than its code is.**

## Imports, closing tally

0 of 12 relative imports carry the `.js` extension, and 15 of 17 compile errors are
that. This run joins 05 (1 of 18) and 03 at the bottom of §3.6's table, against 01
(26 of 26), 04 (22 of 22), 07 (54 of 55) and 02 (9 of 9) at the top. Seven runs at
100% or 0%, and nothing yet predicts which.

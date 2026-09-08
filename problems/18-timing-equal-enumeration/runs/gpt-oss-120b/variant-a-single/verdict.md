# Verdict — 18 The defence no status code can see (gpt-oss-120b, hosted)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✗, M6 ✓, M7 ~]

graded:       {equalization_design: 3, test_honesty: 1, leak_coverage: 2,
               restraint: 3, quality: 1, process: n/a}

typecheck:    failed after 2 repairs — 20 errors, 18 of them unresolved imports
tests:        did not run

failure_mode: wrong_answer
              # The timing test takes one sample per branch and compares the two
              # durations against a 30 ms tolerance. M5 asks for multiple samples
              # and a comparison of distributions; a single pair of measurements on
              # a loaded machine is noise.

revisions:    {self_repairs: 2, dropped_a_requirement: no}
cost:         {wall_minutes: ~4, requests: 3, usd: 0.0078}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     The right defence, measured once.
```

## The defence is correct

    // A dummy password hash is generated once and reused for non-existent accounts
    private readonly dummyHashPromise: Promise<string>;
    this.dummyHashPromise = argon2.hash('dummy_password', { type: argon2.argon2id, … });

The unknown-account branch verifies against a pre-computed argon2id hash rather than
returning early, so both paths pay the same cost. `Math.random` and `setTimeout` appear
nowhere — M2 forbids padding with a random delay and this does not pad at all.

M3 and M6 are asserted directly: the tests compare `res.body`, `res.statusCode` and
headers, with a comment noting that mutable headers like `Date` are excluded. That is
the leak surface the problem asks about, checked rather than assumed.

M4 exists and can fail:

    const start = process.hrtime.bigint();
    const res = await request(app.getHttpServer()).post(path).send(body);
    const durationMs = Number(end - start) / 1_000_000;
    …
    const diff = Math.abs(first.durationMs - second.durationMs);
    expect(diff).toBeLessThanOrEqual(30);

## And it is measured once

One call per branch, one subtraction, a 30 ms tolerance. M5 is explicit that the test
must take "multiple samples, a comparison of distributions or medians rather than" a
single measurement, and the reason is in the problem's title: the signal being defended
against is statistical. A single pair of HTTP round-trips on a machine running a test
suite will differ by tens of milliseconds for reasons that have nothing to do with
hashing — so this test passes when the defence is broken and fails when it is not,
about equally often.

The assertion also has no floor. Qwen3.8-27B's version asserted that **both** means
were large enough to be real work, so removing the hashing to make the test pass would
fail it. Here, two endpoints that both return instantly would pass.

Twenty typecheck errors, eighteen of them unresolved imports, so none of it runs.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B | gpt-oss-120b |
|---|---|---|
| must-haves | **7 of 7** | 6 of 7 |
| equalisation | ghost argon2id hash | dummy argon2id hash |
| samples per branch | **20 and 15** | **1** |
| floor assertion | yes — both means must be real work | none |
| side effect out of band | `void mail.send(…).catch(…)` | partial |
| tests as shipped | blocked by one bad import; **7 of 7 pass** once fixed | do not compile |
| verdict | PASS_WITH_NOTES | FAIL |

The same insight about the defence, and a different standard of proof. Qwen's run was
the strongest of its campaign and needed one import corrected; this one has the right
idea and a test that cannot tell whether the idea worked.

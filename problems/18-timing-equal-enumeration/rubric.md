# Rubric — 18 The defence no status code can see

## Gate: must-haves (missing any = FAIL, regardless of tests)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Both branches do the same work** | The path for a known account and the path for an unknown one perform the same expensive operation. A dummy hash against a fixed verifier, or neither branch hashing at all. |
| M2 | **No random delay** | Padding with `sleep(random())` = ✗. It does not remove the signal, it adds variance to it, and repetition recovers the mean. A fixed floor that every branch is padded up to is acceptable if it is genuinely above the slowest branch. |
| M3 | **Responses are byte-identical** | Same status, same body, same headers. Proven by comparison in a test, not by inspection. Distinct `message` strings per branch = ✗. |
| M4 | **A timing test exists and can fail** | The suite contains a test that measures both branches against each other and fails when they diverge. A test asserting only status or body does not satisfy this, whatever it is named. |
| M5 | **The timing test is honest** | Multiple samples, a comparison of distributions or medians rather than one pair of measurements, and a threshold justified in a comment. A single-sample comparison is noise. |
| M6 | **Nothing else leaks** | Response headers, `Content-Length`, redirect targets, rate-limit counters and log lines at the caller's disposal do not distinguish the branches either. |
| M7 | **Side effects do not reintroduce it** | Anything added to one branch — telemetry, an audit write, an email — is either on both branches or off the request path entirely. An `await`ed analytics call on one branch = ✗. |

## Graded criteria (0–3 each, judged blind against the reference)

1. **Equalisation strategy** — the mechanism chosen, and whether the write-up
   shows the model understood *why* a random delay fails.
2. **Test design** — sampling, statistic and threshold. Does the test fail if
   someone reintroduces the asymmetry tomorrow?
3. **Leak surface** — how far beyond the response body the run looked. Headers,
   logs, rate limiting, downstream side effects.
4. **Honesty about limits** — a local timing test cannot rule out a remote
   attacker with more samples. Saying so is credit; claiming a guarantee is not.
5. **Code quality** — the equalisation is legible, and a future reader can see it
   is deliberate rather than accidental.
6. **Process** (from transcript) — did it reason about the observable, or
   pattern-match "return the same error message"?

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries M1..M7; `graded` carries the six criteria above.

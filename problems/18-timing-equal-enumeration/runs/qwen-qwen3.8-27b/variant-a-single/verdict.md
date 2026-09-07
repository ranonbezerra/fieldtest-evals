# Verdict — 18 The defence no status code can see (hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ✓]

graded:       {equalization_design: 3, test_honesty: 3, leak_coverage: 3,
               restraint: 3, quality: 2, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        as shipped, the suite does not start: `TypeError: swc is not a function`.
              With that one import corrected, **7 of 7 pass** against a live
              PostgreSQL 14, in 21.7 s of real argon2id work.

failure_mode: none
              # The one defect is `import swc from 'unplugin-swc'` where the callable
              # is `swc.vite`. Nothing else in the deliverable is wrong.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: —, output_tokens: —, requests: 1, usd: —}
host:         {n/a — the model is not on this machine}

verification: run by the judge. Workspace copied, `vitest.config.ts` changed to call
              `swc.vite`, `DATABASE_URL` pointed at a fresh database. The model's own
              `test/setup.ts` applied its migration and the suite ran unmodified.

would_merge:  yes, after one import
headline:     A real timing-equalisation, proven by its own statistical test, undone
              at the last inch by the default export of a vite plugin.
```

## The defence is the right one

The unknown-account branch does not sleep. It runs the same argon2id it would have run
against a real password hash:

    // argon2id with OWASP-recommended interactive parameters (19 MiB, 2 passes,
    // parallelism 1). One run costs tens to hundreds of milliseconds, which is
    // what makes the branches of each endpoint take the same amount of time.

    this.ghostHash = await argon2.hash(randomBytes(32).toString('base64'), HASH_OPTIONS);

That comment is the whole insight. The cost of the hash is what the attacker measures,
so the defence is to pay it on both paths — not to hide it behind a delay. M2 forbids
`sleep(random())`; `Math.random` appears nowhere in the service.

On top of that, a deterministic floor:

    const MIN_RESPONSE_MS = 250;
    const remainingMs = MIN_RESPONSE_MS - elapsedMs;
    if (remainingMs > 0) await new Promise((r) => setTimeout(r, remainingMs));

Constant, not random, and layered over equalised work rather than substituted for it.

M7 is handled with the same care:

    // Deliberately fire-and-forget: the caller's response timing must never
    // depend on the mail transport, and a mail failure must never change what
    // the caller observes.
    void this.mail.sendEmail(…).catch((error: unknown) => { … });

The real outcome reaches the user out of band, the caller sees one response, and the
send cannot leak back into the measurement — with a `.catch` attached so it is not an
unhandled rejection either.

## The timing test is honest, and it passes

    it('takes statistically the same time on both branches across repeated samples')
      const SAMPLES = 20;                       // sign-up
      const SAMPLES = 15;                       // sign-in
      expect(takenMean, `… must involve real work`).toBeGreaterThan…
      expect(Math.abs(takenMean - freshMean)).toBeLessThanOrEqual(TOLERANCE_MS);

Twenty samples per branch, an assertion that **both** means are large enough to be real
work — so the test fails if someone "fixes" it by removing the hashing — and a bounded
difference. M5 prefers medians to means; twenty samples with a floor assertion is a
defensible substitute.

Run against a live database:

    ✓ answers a new address and a taken address with byte-identical responses
    ✓ delivers the real outcome through mail while the caller sees the same thing
    ✓ takes statistically the same time on both branches across repeated samples
    ✓ answers a wrong password and an unknown address with byte-identical 401s
    ✓ still lets the legitimate owner in
    ✓ takes statistically the same time on both branches across repeated samples
    ✓ rejects malformed bodies with the standard error envelope

    Test Files  1 passed (1)      Tests  7 passed (7)      21.7 s

## The one line

    import swc from 'unplugin-swc';
    plugins: [ swc({ … }) ]

`unplugin-swc`'s default export is an object of factories — `swc.vite`, `swc.rollup`.
Calling it directly gives `TypeError: swc is not a function` before a single test
loads, which is what the campaign recorded.

## Where this sits

This is the strongest hosted run of the eighteen. Problem 05 matched it on design and
shipped four broken assertions; problem 17 matched it on design and shipped a type
annotation that killed the suite; this one is correct throughout and shipped a wrong
import in a config file.

Three consecutive problems where the engineering is right and the surrounding tooling
is wrong, each in a different file, each one line. **The model builds the thing it was
asked for and then mis-wires the scaffolding around it** — and unlike the reference
gaps of the local campaign, no decomposition and no ceiling had any part in this.

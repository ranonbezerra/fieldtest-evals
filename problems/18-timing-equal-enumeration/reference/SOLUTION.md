# Reference solution — annotated core (KEEP OUT of the model's context)

## The mechanism

```ts
// A verifier hashed once at boot, from a value nobody can present. The unknown-
// account branch verifies against it, so both branches pay for exactly one hash.
//
// M1/M2: this is equalisation by DOING the work, not by padding. A random delay
// adds variance to the signal instead of removing it -- an attacker who samples
// enough recovers the mean, and the defence was never there.
const DUMMY_HASH = await argon2.hash(randomBytes(32).toString('hex'));

async function signIn(email: string, password: string) {
  const user = await users.findByEmail(email);
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = await argon2.verify(hash, password);   // runs on BOTH branches
  if (!user || !ok) throw new InvalidCredentials(); // one throw, one shape
  return issue(user);
}
```

For sign-up the same shape holds: hash the submitted password whether or not the
address is free, and discard it on the taken branch.

## The side effect that reintroduces it

```ts
// M7. This is the regression that came back after the defence was correct and
// tested. The test still passed -- it asserted the bodies, and the difference had
// moved back into the timing.
await analytics.capture('signup.duplicate', { email });   // <-- on one branch only
```

Two acceptable fixes: emit on both branches, or emit on neither and take it off the
request path entirely. **Moving it to a queue is only a fix if enqueueing itself is
on both branches** — an enqueue is fast, not free, and one branch enqueuing is the
same defect at a smaller amplitude.

The same applies to the emails in variant A. Both branches send *an* email; they
differ only in which template, which the caller cannot observe.

## The test that catches it

```ts
// M4/M5. Multiple samples, medians compared, threshold justified.
async function median(fn: () => Promise<unknown>, n = 40): Promise<number> {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    ts.push(performance.now() - t);
  }
  return ts.sort((a, b) => a - b)[Math.floor(n / 2)];
}

it('cannot be distinguished by timing', async () => {
  const known = await median(() => post('/auth/sign-up', { email: taken, password: 'x' }));
  const unknown = await median(() => post('/auth/sign-up', { email: fresh(), password: 'x' }));
  // An argon2 hash dominates both branches at ~150 ms. A 25% divergence means one
  // branch is skipping it; below that is scheduler noise on this machine.
  expect(Math.abs(known - unknown) / Math.max(known, unknown)).toBeLessThan(0.25);
});
```

And the comparison that does not rely on anyone reading carefully:

```ts
// M3. The two 401 bodies compared, not read by eye. Two handlers each throwing
// `new UnauthorizedException('...')` with a different message look correct in
// review and fail here.
expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
expect(a.headers['content-length']).toBe(b.headers['content-length']);
```

## Judging notes

**A single-sample timing test is not M4.** It is noise, and it passes and fails at
random. Look for the sample count and the statistic.

**A `sleep(Math.random() * 200)` is an automatic ✗ on M2**, however confidently the
write-up defends it. A fixed floor — every branch padded up to a constant above the
slowest — is acceptable, and the write-up should acknowledge it costs latency on
every request including the honest ones.

**M6 is where thorough runs separate.** Beyond the body: `Content-Length` differing
because one branch returns an extra field; a rate limiter that only counts one
branch; a log line at a level the caller can trigger and observe; a redirect target.

**Credit honesty on graded-4.** A local test with 40 samples does not rule out an
attacker with a million. A run that says so is stronger than one claiming the leak is
closed.

## Common wrong answers

- Identical responses, unequal work — the exact bug the problem is made of, and the
  most common outcome. The suite is green and the oracle is intact.
- Random delay (M2).
- Equalising sign-in and forgetting sign-up, or vice versa. The endpoints are
  separate and so are the leaks.
- Hoisting the expensive work behind an early `if (!user) return` for "efficiency" —
  a performance instinct that reopens the hole, and it reads as a clean-up.

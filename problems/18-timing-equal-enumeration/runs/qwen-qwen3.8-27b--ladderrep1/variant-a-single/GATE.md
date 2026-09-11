$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 14, reused 13, downloaded 1, added 0
Progress: resolved 184, reused 183, downloaded 1, added 0
Packages: +208
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 255, reused 207, downloaded 1, added 207
Progress: resolved 255, reused 207, downloaded 1, added 208, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ argon2 0.43.1 (0.45.1 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ @types/supertest 6.0.3 (7.2.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ supertest 7.2.2
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.5s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 100ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Interested in query caching in just a few lines of code? Try Accelerate today! https://pris.ly/tip-3-accelerate



$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:162:27
    160|     try {
    161|       const seed = await signUp(server, 'seeded@example.test', 'seeded…
    162|       expect(seed.status).toBe(202);
       |                           ^
    163| 
    164|       const existing = await signUp(server, 'seeded@example.test', 'ri…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-up > creates the account once and a second sign-up never overwrites it
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:186:28
    184|     try {
    185|       const first = await signUp(server, 'owner@example.test', 'origin…
    186|       expect(first.status).toBe(202);
       |                            ^
    187|       const again = await signUp(server, 'owner@example.test', 'rival-…
    188|       expect(again.status).toBe(202);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-up > treats case variants of the same address as the same address
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:205:95
    203|     const { app, server } = await buildApp(service, port);
    204|     try {
    205|       expect((await signUp(server, 'Mixed.Case@Example.test', 'origina…
       |                                                                                               ^
    206|       expect((await signUp(server, 'mixed.case@example.test', 'rival-p…
    207| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-up > sends exactly one verification email for a new address
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:220:89
    218|     const { app, server } = await buildApp(service, port);
    219|     try {
    220|       expect((await signUp(server, 'newbie@example.test', 'newbie-pass…
       |                                                                                         ^
    221|       await waitUntil(() => sent.length === 1, 'the verification email…
    222|       expect(sent).toEqual([

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-up > sends a "someone tried to sign up" email for an existing address
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:235:89
    233|     const { app, server } = await buildApp(service, port);
    234|     try {
    235|       expect((await signUp(server, 'seeded@example.test', 'seeded-pass…
       |                                                                                         ^
    236|       await waitUntil(() => sent.length === 1, 'the first email');
    237| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-up > changes nothing the caller observes when mail delivery fails
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:263:28
    261|       const existing = await signUp(server, 'no-mail@example.test', 'n…
    262| 
    263|       expect(fresh.status).toBe(202);
       |                            ^
    264|       expect(existing.status).toBe(202);
    265|       expect(Buffer.from(fresh.text)).toEqual(Buffer.from(existing.tex…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-up > takes statistically the same time for a new and an existing address
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ timedPost test/auth.spec.ts:142:27
    140|   // Guard: if a branch started failing, the test must not silently ti…
    141|   // different (fast error) path and pass on the wrong data.
    142|   expect(response.status).toBe(expectedStatus);
       |                           ^
    143|   return elapsedMs;
    144| }
 ❯ test/auth.spec.ts:305:11

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-in > returns byte-identical responses for a wrong password and an unknown address
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:341:89
    339|     const { app, server } = await buildApp(service, port);
    340|     try {
    341|       expect((await signUp(server, 'known@example.test', 'known-passwo…
       |                                                                                         ^
    342| 
    343|       const wrongPassword = await signIn(server, 'known@example.test',…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-in > accepts the correct credentials
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:369:89
    367|     const { app, server } = await buildApp(service, port);
    368|     try {
    369|       expect((await signUp(server, 'known@example.test', 'known-passwo…
       |                                                                                         ^
    370|       const response = await signIn(server, 'known@example.test', 'kno…
    371|       expect(response.status).toBe(200);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/10]⎯

 FAIL  test/auth.spec.ts > POST /auth/sign-in > takes statistically the same time for a wrong password and an unknown address
AssertionError: expected 500 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 500

 ❯ test/auth.spec.ts:384:80
    382|     try {
    383|       const knownEmail = 'timing-known@example.test';
    384|       expect((await signUp(server, knownEmail, 'timing-known-pass-1'))…
       |                                                                                ^
    385|       // Warm-up: sockets, dummy-hash generation, argon2 native init.
    386|       await signIn(server, knownEmail, 'warm-up-wrong-1');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/10]⎯



$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 12, reused 8, downloaded 4, added 0
Progress: resolved 13, reused 9, downloaded 4, added 0
Progress: resolved 120, reused 114, downloaded 5, added 0
Progress: resolved 290, reused 211, downloaded 7, added 0
Packages: +219
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 291, reused 212, downloaded 7, added 218
Progress: resolved 291, reused 212, downloaded 7, added 219, done

dependencies:
+ @nestjs/common 11.2.3 (12.0.1 is available)
+ @nestjs/core 11.2.3 (12.0.1 is available)
+ @nestjs/platform-express 11.2.3 (12.0.1 is available)
+ @prisma/client 6.19.3 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 11.2.3 (12.0.1 is available)
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (26.4.1 is available)
+ @types/supertest 6.0.3 (7.2.1 is available)
+ prisma 6.19.3 (8.0.0-rc.13 is available)
+ supertest 7.2.2
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 5.5s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v6.19.3) to ./node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client in 42ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to turn off tips and other hints? https://pris.ly/tip-4-nohints



$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/05-onchain-anchoring/runs/qwen-qwen3.8-27b/variant-a-single/workspace


 Test Files  no tests
      Tests  no tests
   Start at  00:22:05
   Duration  18ms (transform 10ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 0ms)


⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
Error: DATABASE_URL must point at a PostgreSQL instance to run the test suite.
 ❯ Object.globalSetup [as setup] test/global-setup.ts:5:11
      3| /**
      4|  * Runs once, in the main process, before any test file is imported. T…
      5|  * modules import the generated Prisma client at load time, so the cli…
       |           ^
      6|  * be generated and the schema migrated before that happens.
      7|  */
 ❯ WorkspaceProject.initializeGlobalSetup node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:9926:53
 ❯ Vitest.initializeGlobalSetup node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:10794:7
 ❯ node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:10816:7
 ❯ Vitest.runFiles node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:10840:12
 ❯ Vitest.start node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:10682:7
 ❯ startVitest node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js:11848:7
 ❯ start node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cac.CB_9Zo9Q.js:1506:17
 ❯ CAC.run node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/dist/chunks/cac.CB_9Zo9Q.js:1486:3






$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/05-onchain-anchoring/runs/qwen-qwen3.8-27b/variant-a-single/workspace

Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v6.19.3) to ./node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client in 46ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to turn off tips and other hints? https://pris.ly/tip-4-nohints

Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "ft_anchoring", schema "public" at "127.0.0.1:5432"

1 migration found in prisma/migrations

Applying migration `20250601000000_init`

The following migration(s) have been applied:

migrations/
  └─ 20250601000000_init/
    └─ migration.sql
      
All migrations have been successfully applied.
 ❯ test/anchoring.spec.ts (15 tests | 4 failed) 830ms
   ✓ canonicalization > pins the canonical text and hash of a flat object 424ms
   × anchorDocument > persists the anchor intent (with tx identity) before broadcasting, then the confirmation worker advances it to confirmed 109ms
     → expected 1000n to be an instance of BigInt
   × anchorDocument > survives a process crash between broadcast and confirmation: the recovery sweep queries the chain first and keeps exactly one on-chain anchor 30ms
     → expected 'broadcast_sent' to be 'confirmed' // Object.is equality
   × anchorDocument > recovers a broadcast timeout that DID land by confirming from the receipt, without re-broadcasting 46ms
     → expected 1000n to be an instance of BigInt
   × verify > returns the anchoring proof for matching content, and a mismatch report otherwise 18ms
     → expected 201 to be 200 // Object.is equality

 Test Files  1 failed (1)
      Tests  4 failed | 11 passed (15)
   Start at  04:38:55
   Duration  2.92s (transform 53ms, setup 0ms, collect 267ms, tests 830ms, environment 0ms, prepare 36ms)

┌─────────────────────────────────────────────────────────┐
│  Update available 6.19.3 -> 8.0.0-rc.13                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/anchoring.spec.ts > anchorDocument > persists the anchor intent (with tx identity) before broadcasting, then the confirmation worker advances it to confirmed
AssertionError: expected 1000n to be an instance of BigInt
 ❯ test/anchoring.spec.ts:154:40
    152|       const confirmedRow = row as Anchor;
    153|       expect(confirmedRow.status).toBe('confirmed');
    154|       expect(confirmedRow.blockNumber).toBeInstanceOf(BigInt);
       |                                        ^
    155|       expect(confirmedRow.confirmedAt).toBeInstanceOf(Date);
    156| 
 ❯ withApp test/anchoring.spec.ts:75:5
 ❯ test/anchoring.spec.ts:124:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  test/anchoring.spec.ts > anchorDocument > survives a process crash between broadcast and confirmation: the recovery sweep queries the chain first and keeps exactly one on-chain anchor
AssertionError: expected 'broadcast_sent' to be 'confirmed' // Object.is equality

Expected: "confirmed"
Received: "broadcast_sent"

 ❯ test/anchoring.spec.ts:199:38
    197|       const row = await prisma.anchor.findUnique({ where: whereFor('do…
    198|       expect(row).not.toBeNull();
    199|       expect((row as Anchor).status).toBe('confirmed');
       |                                      ^
    200|       expect((row as Anchor).blockNumber).toBeInstanceOf(BigInt);
    201| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  test/anchoring.spec.ts > anchorDocument > recovers a broadcast timeout that DID land by confirming from the receipt, without re-broadcasting
AssertionError: expected 1000n to be an instance of BigInt
 ❯ test/anchoring.spec.ts:296:31
    294|       const row = (await prisma.anchor.findUnique({ where: whereFor('d…
    295|       expect(row.status).toBe('confirmed');
    296|       expect(row.blockNumber).toBeInstanceOf(BigInt);
       |                               ^
    297|       expect(chain.broadcasts).toHaveLength(1); // no re-broadcast: th…
    298|       expect(chain.distinctTxIds()).toHaveLength(1);
 ❯ withApp test/anchoring.spec.ts:75:5
 ❯ test/anchoring.spec.ts:282:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  test/anchoring.spec.ts > verify > returns the anchoring proof for matching content, and a mismatch report otherwise
AssertionError: expected 201 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 201

 ❯ test/anchoring.spec.ts:379:24
    377|         content: { b: { c: 2 }, a: 1 },
    378|       });
    379|       expect(v.status).toBe(200);
       |                        ^
    380|       expect(v.body.match).toBe(true);
    381|       expect(v.body.confirmed).toBe(false);
 ❯ withApp test/anchoring.spec.ts:75:5
 ❯ test/anchoring.spec.ts:365:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯



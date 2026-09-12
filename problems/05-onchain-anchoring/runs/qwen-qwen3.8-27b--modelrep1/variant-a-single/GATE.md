$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 31, reused 20, downloaded 0, added 0
Packages: +172
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 244, reused 172, downloaded 0, added 117
Progress: resolved 244, reused 172, downloaded 0, added 172, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.8s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 22ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to react to database changes in your app as they happen? Discover how with Pulse: https://pris.ly/tip-1-pulse



$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/05-onchain-anchoring/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace

 ❯ test/anchor.spec.ts (14 tests | 14 skipped) 192ms
 ❯ test/anchor-api.spec.ts (8 tests | 8 skipped) 168ms

 Test Files  2 failed (2)
      Tests  22 skipped (22)
   Start at  21:18:14
   Duration  981ms (transform 45ms, setup 0ms, collect 509ms, tests 361ms, environment 0ms, prepare 27ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/anchor-api.spec.ts [ test/anchor-api.spec.ts ]
Error: Could not apply Prisma migrations. Ensure DATABASE_URL is set and reachable: Command failed: node /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/05-onchain-anchoring/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/node_modules/prisma/build/index.js migrate deploy
Error: Prisma schema validation - (get-config wasm)
Error code: P1012
error: Environment variable not found: DATABASE_URL.
  -->  prisma/schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
[Context: getConfig]

Prisma CLI Version : 5.22.0

 ❯ Module.ensureDatabaseSchema test/setup.ts:15:11
     13|   } catch (err) {
     14|     const detail = err instanceof Error ? err.message : String(err);
     15|     throw new Error(`Could not apply Prisma migrations. Ensure DATABAS…
       |           ^
     16|   }
     17| }
 ❯ test/anchor-api.spec.ts:38:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/anchor-api.spec.ts [ test/anchor-api.spec.ts ]
TypeError: Cannot read properties of undefined (reading 'close')
 ❯ test/anchor-api.spec.ts:59:13
     57| 
     58| afterAll(async () => {
     59|   await app.close();
       |             ^
     60|   await prisma.$disconnect();
     61| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/anchor.spec.ts [ test/anchor.spec.ts ]
Error: Could not apply Prisma migrations. Ensure DATABASE_URL is set and reachable: Command failed: node /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/05-onchain-anchoring/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/node_modules/prisma/build/index.js migrate deploy
Error: Prisma schema validation - (get-config wasm)
Error code: P1012
error: Environment variable not found: DATABASE_URL.
  -->  prisma/schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
[Context: getConfig]

Prisma CLI Version : 5.22.0

 ❯ Module.ensureDatabaseSchema test/setup.ts:15:11
     13|   } catch (err) {
     14|     const detail = err instanceof Error ? err.message : String(err);
     15|     throw new Error(`Could not apply Prisma migrations. Ensure DATABAS…
       |           ^
     16|   }
     17| }
 ❯ test/anchor.spec.ts:48:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯



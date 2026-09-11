$ pnpm install -> 0
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +172
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 172, reused 172, downloaded 0, added 172, done

dependencies:
+ @nestjs/common 10.4.22
+ @nestjs/core 10.4.22
+ @nestjs/platform-express 10.4.22
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/express 4.17.25
+ @types/node 22.20.1
+ typescript 5.9.3
+ vitest 2.1.9

Done in 719ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ✓ test/users.service.spec.ts (2 tests) 2ms
 ❯ test/app.module.spec.ts (1 test | 1 failed) 79ms
   × AppModule wiring > resolves every provider across every module boundary 78ms
     → Cannot read properties of undefined (reading 'user')

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 2 passed (3)
   Start at  14:20:47
   Duration  774ms (transform 773ms, setup 0ms, collect 1.01s, tests 80ms, environment 0ms, prepare 60ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/app.module.spec.ts > AppModule wiring > resolves every provider across every module boundary
TypeError: Cannot read properties of undefined (reading 'user')
 ❯ ExportService.enqueue src/users/export.service.ts:14:37
     12| 
     13|   async enqueue(requestedBy: string): Promise<ExportJob> {
     14|     const rows = (await this.prisma.user.findMany()).length;
       |                                     ^
     15|     return { id: `exp_${requestedBy}_${rows}`, rows };
     16|   }
 ❯ test/app.module.spec.ts:35:63

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



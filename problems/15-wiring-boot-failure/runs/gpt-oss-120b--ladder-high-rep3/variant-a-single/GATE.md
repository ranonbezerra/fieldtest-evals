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

Done in 587ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 0

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

 ✓ test/users.service.spec.ts (2 tests) 1ms
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[NestFactory] [39m[32mStarting Nest application...[39m
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[InstanceLoader] [39m[32mAppModule dependencies initialized[39m[38;5;3m +3ms[39m
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[InstanceLoader] [39m[32mConfigModule dependencies initialized[39m[38;5;3m +0ms[39m
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[InstanceLoader] [39m[32mPrismaModule dependencies initialized[39m[38;5;3m +0ms[39m
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[InstanceLoader] [39m[32mUsersModule dependencies initialized[39m[38;5;3m +0ms[39m
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[InstanceLoader] [39m[32mNotificationsModule dependencies initialized[39m[38;5;3m +0ms[39m
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[InstanceLoader] [39m[32mJobsModule dependencies initialized[39m[38;5;3m +0ms[39m
[32m[Nest] 86835  - [39m09/12/2026, 8:12:22 PM [32m    LOG[39m [38;5;3m[InstanceLoader] [39m[32mExportsModule dependencies initialized[39m[38;5;3m +0ms[39m
 ✓ test/app-wiring.spec.ts (1 test) 5ms

 Test Files  2 passed (2)
      Tests  3 passed (3)
   Start at  20:12:22
   Duration  655ms (transform 726ms, setup 0ms, collect 927ms, tests 6ms, environment 0ms, prepare 61ms)



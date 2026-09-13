$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 27, reused 26, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.14 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.4s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 12ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 24ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Help us improve the Prisma ORM for everyone. Share your feedback in a short 2-min survey: https://pris.ly/orm/survey/release-5-22



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,45): error TS2307: Cannot find module '@prisma/nestjs' or its corresponding type declarations.
src/app.module.ts(3,28): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './main.js'?
src/app.module.ts(4,30): error TS2307: Cannot find module './payout/payout.module' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/payout/payout.controller.ts(2,31): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/payout/payout.controller.ts(3,33): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
src/payout/payout.module.ts(2,34): error TS2307: Cannot find module './payout.controller' or its corresponding type declarations.
src/payout/payout.module.ts(3,31): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/payout/payout.module.ts(4,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.module.ts(5,30): error TS2307: Cannot find module './payout.worker' or its corresponding type declarations.
src/payout/payout.module.ts(6,33): error TS2307: Cannot find module './provider.service' or its corresponding type declarations.
src/payout/payout.repository.ts(2,31): error TS2307: Cannot find module '@prisma/nestjs' or its corresponding type declarations.
src/payout/payout.repository.ts(7,8): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
src/payout/payout.repository.ts(33,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(149,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.service.ts(2,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.service.ts(3,33): error TS2307: Cannot find module './provider.service' or its corresponding type declarations.
src/payout/payout.service.ts(12,8): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
src/payout/payout.worker.ts(2,31): error TS2307: Cannot find module '@prisma/nestjs' or its corresponding type declarations.
src/payout/payout.worker.ts(3,31): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/payout/payout.worker.ts(4,31): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
src/payout/payout.worker.ts(5,62): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
src/payout/provider.service.ts(2,26): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
test/payout.spec.ts(2,31): error TS2307: Cannot find module '../src/payout/payout.service' or its corresponding type declarations.
test/payout.spec.ts(3,34): error TS2307: Cannot find module '../src/payout/payout.repository' or its corresponding type declarations.
test/payout.spec.ts(4,33): error TS2307: Cannot find module '../src/payout/provider.service' or its corresponding type declarations.
test/payout.spec.ts(12,8): error TS2307: Cannot find module '../src/payout/payout.types' or its corresponding type declarations.
test/payout.spec.ts(169,14): error TS2352: Conversion of type 'MockMessage' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'MockMessage'.
test/payout.spec.ts(197,60): error TS2304: Cannot find name 'PrismaService'.
test/payout.spec.ts(282,37): error TS2551: Property 'allSettased' does not exist on type 'PromiseConstructor'. Did you mean 'allSettled'?
test/payout.spec.ts(287,41): error TS7006: Parameter 'r' implicitly has an 'any' type.
test/payout.spec.ts(288,40): error TS7006: Parameter 'r' implicitly has an 'any' type.
test/payout.spec.ts(380,60): error TS2304: Cannot find name 'PrismaService'.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(3,10): error TS2305: Module '"./main.js"' has no exported member 'MainModule'.
src/payout/payout.repository.ts(2,31): error TS2307: Cannot find module '../../prisma/prisma.service.js' or its corresponding type declarations.
src/payout/payout.service.ts(38,9): error TS2345: Argument of type 'number' is not assignable to parameter of type 'bigint'.
src/payout/payout.service.ts(50,42): error TS2341: Property 'prisma' is private and only accessible within class 'PayoutRepository'.
src/payout/payout.worker.ts(2,31): error TS2307: Cannot find module '../../prisma/prisma.service.js' or its corresponding type declarations.
test/payout.spec.ts(170,14): error TS2352: Conversion of type 'MockMessage' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'MockMessage'.
test/payout.spec.ts(293,26): error TS2339: Property 'reason' does not exist on type 'PromiseSettledResult<any>'.
  Property 'reason' does not exist on type 'PromiseFulfilledResult<any>'.


$ tsc --noEmit (attempt 2) -> 2
src/payout/payout.repository.ts(14,24): error TS2339: Property 'account' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(18,24): error TS2339: Property 'account' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(24,24): error TS2339: Property 'payout' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(33,24): error TS2339: Property '$transaction' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(67,24): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(75,38): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(89,24): error TS2339: Property 'payout' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(96,24): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(103,24): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(110,24): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(120,24): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(135,24): error TS2339: Property 'payout' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(149,24): error TS2339: Property '$transaction' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(166,24): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(182,24): error TS2339: Property 'payout' does not exist on type 'PrismaService'.
src/payout/payout.repository.ts(194,24): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.service.ts(50,49): error TS2339: Property 'payout' does not exist on type 'PrismaService'.
src/payout/payout.worker.ts(18,23): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.worker.ts(31,40): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.worker.ts(57,38): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.worker.ts(71,23): error TS2339: Property 'message' does not exist on type 'PrismaService'.
src/payout/payout.worker.ts(78,23): error TS2339: Property 'message' does not exist on type 'PrismaService'.
test/payout.spec.ts(170,14): error TS2352: Conversion of type 'MockMessage' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'MockMessage'.


$ vitest run -> 1
nsufficient funds 1ms
     → expected error to be instance of InsufficientFundsException
   × PayoutService > createPayout > rejects when account does not exist 0ms
     → expected error to be instance of AccountNotFoundException
   × PayoutService > createPayout > returns existing payout on duplicate idempotency key 0ms
     → Cannot read properties of undefined (reading 'findUnique')
   × PayoutService > createPayout > exactly one payout succeeds under concurrent creation (two races) 1ms
     → expected +0 to be 1 // Object.is equality
   × PayoutService > processPayout — provider failure with bounded retries > moves payout to NEEDS_REVIEW after exhausting retries, reservation intact 0ms
     → Cannot read properties of undefined (reading 'findUnique')
   × PayoutService > processPayout — successful transfer and settlement > settles balance only after provider confirms 0ms
     → Cannot read properties of undefined (reading 'findUnique')
   × PayoutWorker duplicate delivery > same message processed twice results in only one transfer 0ms
     → Cannot read properties of undefined (reading 'findUnique')

 Test Files  1 failed (1)
      Tests  8 failed (8)
   Start at  23:00:52
   Duration  587ms (transform 349ms, setup 0ms, collect 425ms, tests 6ms, environment 0ms, prepare 38ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/payout.spec.ts > PayoutService > createPayout > creates a payout and reserves funds when balance is sufficient
TypeError: Cannot read properties of undefined (reading 'findUnique')
 ❯ PayoutRepository.findAccountById src/payout/payout.repository.ts:14:32
     12| 
     13|   async findAccountById(accountId: string) {
     14|     return this.prisma.account.findUnique({ where: { id: accountId } }…
       |                                ^
     15|   }
     16| 
 ❯ PayoutService.createPayout src/payout/payout.service.ts:22:43
 ❯ test/payout.spec.ts:220:36

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/8]⎯

 FAIL  test/payout.spec.ts > PayoutService > createPayout > rejects when account has insufficient funds
AssertionError: expected error to be instance of InsufficientFundsException

- Expected: 
[Function InsufficientFundsException]

+ Received: 
[TypeError: Cannot read properties of undefined (reading 'findUnique')]

 ❯ test/payout.spec.ts:239:7
    237|       };
    238| 
    239|       await expect(service.createPayout(dto)).rejects.toThrow(Insuffic…
       |       ^
    240|     });
    241| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/8]⎯

 FAIL  test/payout.spec.ts > PayoutService > createPayout > rejects when account does not exist
AssertionError: expected error to be instance of AccountNotFoundException

- Expected: 
[Function AccountNotFoundException]

+ Received: 
[TypeError: Cannot read properties of undefined (reading 'findUnique')]

 ❯ test/payout.spec.ts:250:7
    248|       };
    249| 
    250|       await expect(service.createPayout(dto)).rejects.toThrow(AccountN…
       |       ^
    251|     });
    252| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/8]⎯

 FAIL  test/payout.spec.ts > PayoutService > createPayout > returns existing payout on duplicate idempotency key
TypeError: Cannot read properties of undefined (reading 'findUnique')
 ❯ PayoutRepository.findAccountById src/payout/payout.repository.ts:14:32
     12| 
     13|   async findAccountById(accountId: string) {
     14|     return this.prisma.account.findUnique({ where: { id: accountId } }…
       |                                ^
     15|   }
     16| 
 ❯ PayoutService.createPayout src/payout/payout.service.ts:22:43
 ❯ test/payout.spec.ts:263:35

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/8]⎯

 FAIL  test/payout.spec.ts > PayoutService > createPayout > exactly one payout succeeds under concurrent creation (two races)
AssertionError: expected +0 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 0

 ❯ test/payout.spec.ts:291:32
    289|       const failures = results.filter((r): r is PromiseRejectedResult …
    290| 
    291|       expect(successes.length).toBe(1);
       |                                ^
    292|       expect(failures.length).toBe(1);
    293|       expect(failures[0].reason).toBeInstanceOf(InsufficientFundsExcep…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/8]⎯

 FAIL  test/payout.spec.ts > PayoutService > processPayout — provider failure with bounded retries > moves payout to NEEDS_REVIEW after exhausting retries, reservation intact
TypeError: Cannot read properties of undefined (reading 'findUnique')
 ❯ PayoutService.processPayout src/payout/payout.service.ts:50:56
     48| 
     49|   async processPayout(payoutId: string) {
     50|     const payout = await this.repository.prisma.payout.findUnique({
       |                                                        ^
     51|       where: { id: payoutId },
     52|     });
 ❯ test/payout.spec.ts:323:21

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/8]⎯

 FAIL  test/payout.spec.ts > PayoutService > processPayout — successful transfer and settlement > settles balance only after provider confirms
TypeError: Cannot read properties of undefined (reading 'findUnique')
 ❯ PayoutService.processPayout src/payout/payout.service.ts:50:56
     48| 
     49|   async processPayout(payoutId: string) {
     50|     const payout = await this.repository.prisma.payout.findUnique({
       |                                                        ^
     51|       where: { id: payoutId },
     52|     });
 ❯ test/payout.spec.ts:361:21

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/8]⎯

 FAIL  test/payout.spec.ts > PayoutWorker duplicate delivery > same message processed twice results in only one transfer
TypeError: Cannot read properties of undefined (reading 'findUnique')
 ❯ PayoutService.processPayout src/payout/payout.service.ts:50:56
     48| 
     49|   async processPayout(payoutId: string) {
     50|     const payout = await this.repository.prisma.payout.findUnique({
       |                                                        ^
     51|       where: { id: payoutId },
     52|     });
 ❯ test/payout.spec.ts:409:19

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/8]⎯



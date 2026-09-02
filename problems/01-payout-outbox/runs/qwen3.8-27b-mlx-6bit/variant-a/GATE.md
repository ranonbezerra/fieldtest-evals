$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 84
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.1 (26.4.1 is available)
+ prisma 5.22.0 (8.0.0-rc.12 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (4.1.11 is available)

Done in 2.7s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 30ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/outbox/outbox.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/outbox/outbox.repository.ts(21,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/outbox/outbox.repository.ts(45,29): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/outbox/outbox.repository.ts(52,24): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
src/payout/payout.repository.ts(38,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(117,43): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.service.ts(64,42): error TS2339: Property 'findByAccountIdAndIdempotencyKey' does not exist on type 'PayoutRepository'.
src/payout/provider.interface.ts(1,41): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
test/payout.spec.ts(191,61): error TS2304: Cannot find name 'PayoutResponse'.


$ tsc --noEmit (attempt 1) -> 2
src/outbox/outbox.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
src/outbox/outbox.service.ts(2,28): error TS2459: Module '"./outbox.repository.js"' declares 'OutboxMessageRow' locally, but it is not exported.
src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
test/payout.spec.ts(51,33): error TS2345: Argument of type '{ createPayoutWithReservation: Mock<Procedure>; updatePayout: Mock<Procedure>; findById: Mock<Procedure>; findByAccountIdAndIdempotencyKey: Mock<...>; confirmPayoutLedger: Mock<...>; }' is not assignable to parameter of type 'PayoutRepository'.
  Property 'prisma' is missing in type '{ createPayoutWithReservation: Mock<Procedure>; updatePayout: Mock<Procedure>; findById: Mock<Procedure>; findByAccountIdAndIdempotencyKey: Mock<...>; confirmPayoutLedger: Mock<...>; }' but required in type 'PayoutRepository'.
test/payout.spec.ts(266,32): error TS2345: Argument of type '{ claimPending: Mock<Procedure>; markDone: Mock<Procedure>; recordAttempt: Mock<Procedure>; }' is not assignable to parameter of type 'OutboxRepository'.
  Property 'prisma' is missing in type '{ claimPending: Mock<Procedure>; markDone: Mock<Procedure>; recordAttempt: Mock<Procedure>; }' but required in type 'OutboxRepository'.
test/payout.spec.ts(273,23): error TS2339: Property 'mockResolvedValue' does not exist on type '(params: { to: string; amount: bigint; }) => Promise<{ txHash: string; }>'.
test/payout.spec.ts(294,23): error TS2339: Property 'mockResolvedValue' does not exist on type '(params: { to: string; amount: bigint; }) => Promise<{ txHash: string; }>'.
test/payout.spec.ts(320,25): error TS2339: Property 'mockRejectedValueOnce' does not exist on type '(params: { to: string; amount: bigint; }) => Promise<{ txHash: string; }>'.
test/payout.spec.ts(340,23): error TS2339: Property 'mockRejectedValueOnce' does not exist on type '(params: { to: string; amount: bigint; }) => Promise<{ txHash: string; }>'.
test/payout.spec.ts(348,23): error TS2339: Property 'mockResolvedValueOnce' does not exist on type '(params: { to: string; amount: bigint; }) => Promise<{ txHash: string; }>'.


$ tsc --noEmit (attempt 2) -> 2
src/outbox/outbox.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
src/outbox/outbox.repository.ts(56,45): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
src/payout/payout.repository.ts(69,45): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(144,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
test/payout.spec.ts(61,25): error TS2552: Cannot find name 'UneprocessableEntityException'. Did you mean 'UnprocessableEntityException'?


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace

 ❯ test/payout.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  08:53:02
   Duration  776ms (transform 483ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 41ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/payout.spec.ts [ test/payout.spec.ts ]
Error: Cannot find module '.prisma/client/default'
Require stack:
- /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/default.js
 ❯ Object.<anonymous> node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/default.js:2:6

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace

 ❯ test/payout.spec.ts (10 tests | 4 failed) 7ms
   × PayoutService > throws UnprocessableEntityException when funds are insufficient (concurrent overdraft guard) 2ms
     → UneprocessableEntityException is not defined
   × PayoutService > throws NotFoundException when the account does not exist 1ms
     → expected error to be instance of NotFoundException
   × PayoutService > returns the existing payout when the same idempotency key and body are retried 0ms
     → Unique constraint failed
   × PayoutService > throws ConflictException when the same idempotency key is reused with a different body 0ms
     → expected error to be instance of ConflictException

⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯

Vitest caught 1 unhandled error during the test run.
This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  4 failed | 6 passed (10)
     Errors  1 error
   Start at  08:53:36
   Duration  773ms (transform 491ms, setup 0ms, collect 588ms, tests 7ms, environment 0ms, prepare 44ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/payout.spec.ts > PayoutService > throws UnprocessableEntityException when funds are insufficient (concurrent overdraft guard)
ReferenceError: UneprocessableEntityException is not defined
 ❯ test/payout.spec.ts:61:25
     59|       destinationAddress: '0xabc',
     60|       idempotencyKey: 'key-1',
     61|     })).rejects.toThrow(UneprocessableEntityException);
       |                         ^
     62|   });
     63| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  test/payout.spec.ts > PayoutService > throws NotFoundException when the account does not exist
AssertionError: expected error to be instance of NotFoundException

- Expected: 
[Function NotFoundException]

+ Received: 
[HttpException: Http Exception]

 ❯ test/payout.spec.ts:67:5
     65|     vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new …
     66| 
     67|     await expect(service.create({
       |     ^
     68|       accountId: 'nonexistent',
     69|       amount: '100',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  test/payout.spec.ts > PayoutService > returns the existing payout when the same idempotency key and body are retried
Error: Unique constraint failed
 ❯ test/payout.spec.ts:76:33
     74| 
     75|   it('returns the existing payout when the same idempotency key and bo…
     76|     const p2002 = Object.assign(new Error('Unique constraint failed'),…
       |                                 ^
     77|     vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(…
     78| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  test/payout.spec.ts > PayoutService > throws ConflictException when the same idempotency key is reused with a different body
AssertionError: expected error to be instance of ConflictException

- Expected: 
[Function ConflictException]

+ Received: 
[Error: Unique constraint failed]

 ❯ test/payout.spec.ts:119:5
    117|     vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue…
    118| 
    119|     await expect(service.create({
       |     ^
    120|       accountId: 'acct-1',
    121|       amount: '300',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
HttpException: Http Exception
 ❯ PayoutService.create src/payout/payout.service.ts:91:15
     89| 
     90|       if (err instanceof Error && err.message === 'INSUFFICIENT_FUNDS'…
     91|         throw new HttpException(
       |               ^
     92|           { error: { code: ERROR_INSUFFICIENT_FUNDS, message: 'account…
     93|           HttpStatus.UNPROCESSABLE_ENTITY,
 ❯ processTicksAndRejections node:internal/process/task_queues:104:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { response: { error: { code: 'insufficient_funds', message: 'account does not have sufficient available funds', details: {} } }, status: 422, options: undefined, initCause: 'Function<initCause>', initMessage: 'Function<initMessage>', initName: 'Function<initName>', getResponse: 'Function<getResponse>', getStatus: 'Function<getStatus>' }
This error originated in "test/payout.spec.ts" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.
The latest test that might've caused the error is "test/payout.spec.ts". It might mean one of the following:
- The error was thrown, while Vitest was running this test.
- If the error occurred after the test had been completed, this was the last documented test before it was thrown.



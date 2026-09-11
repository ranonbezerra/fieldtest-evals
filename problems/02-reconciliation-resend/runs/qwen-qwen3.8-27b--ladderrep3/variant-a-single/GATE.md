$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 28, reused 27, downloaded 0, added 0
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
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.5s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 83ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to turn off tips and other hints? https://pris.ly/tip-4-nohints



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,30): error TS2307: Cannot find module './payout/payout.module' or its corresponding type declarations.
src/main.ts(4,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/payout/payout.module.ts(2,30): error TS2307: Cannot find module '../prisma/prisma.module' or its corresponding type declarations.
src/payout/payout.module.ts(3,29): error TS2307: Cannot find module './bank.client' or its corresponding type declarations.
src/payout/payout.module.ts(4,33): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.module.ts(5,38): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/payout/payout.module.ts(6,33): error TS2307: Cannot find module './payout.processor' or its corresponding type declarations.
src/payout/payout.processor.ts(2,53): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/payout/payout.repository.ts(5,28): error TS2307: Cannot find module './bank.client' or its corresponding type declarations.
src/payout/payout.service.ts(11,8): error TS2307: Cannot find module './bank.client' or its corresponding type declarations.
src/payout/payout.service.ts(12,38): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/prisma/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
test/payout.processor.spec.ts(7,8): error TS2307: Cannot find module '../src/payout/payout.processor' or its corresponding type declarations.
test/payout.processor.spec.ts(8,38): error TS2307: Cannot find module '../src/payout/payout.service' or its corresponding type declarations.
test/payout.service.spec.ts(13,8): error TS2307: Cannot find module '../src/payout/bank.client' or its corresponding type declarations.
test/payout.service.spec.ts(14,50): error TS2307: Cannot find module '../src/payout/payout.repository' or its corresponding type declarations.
test/payout.service.spec.ts(20,8): error TS2307: Cannot find module '../src/payout/payout.service' or its corresponding type declarations.
test/payout.service.spec.ts(132,7): error TS2561: Object literal may only specify known properties, but 'order' does not exist in type '{ id: string; txid: string; settledAt: Date; orderId: string; statementDate: string; recordedAt: Date; }'. Did you mean to write 'orderId'?


$ tsc --noEmit (attempt 1) -> 2
src/payout/payout.repository.ts(128,7): error TS2322: Type '{ orderId: string; txid: string; statementDate: string; settledAt: Date; order: { connect: { id: string; }; }; }' is not assignable to type '(Without<SettlementRecordCreateInput, SettlementRecordUncheckedCreateInput> & SettlementRecordUncheckedCreateInput) | (Without<...> & SettlementRecordCreateInput)'.
  Types of property 'order' are incompatible.
    Type '{ connect: { id: string; }; }' is not assignable to type 'undefined'.
test/payout.service.spec.ts(157,31): error TS2345: Argument of type 'FakeOrderRepository' is not assignable to parameter of type 'OrderRepository'.
  Property 'prisma' is missing in type 'FakeOrderRepository' but required in type 'OrderRepository'.


$ tsc --noEmit (attempt 2) -> 2
src/payout/payout.module.ts(11,5): error TS2693: 'OrderRepository' only refers to a type, but is being used as a value here.


$ vitest run -> 1
9m[32morder 88000979-a55c-44d7-8def-e1279b9995e4 accepted (attempt 1/5)[39m
[32m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [32m    LOG[39m [38;5;3m[PayoutService] [39m[32morder 88000979-a55c-44d7-8def-e1279b9995e4 settled via statement 2025-03-10[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder db17d376-6a49-4d22-a19e-ad44bc74a64c send outcome unknown (attempt 1/5); awaiting statement evidence[39m
[32m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [32m    LOG[39m [38;5;3m[PayoutService] [39m[32morder db17d376-6a49-4d22-a19e-ad44bc74a64c accepted (attempt 2/5)[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder a3349cf1-160b-41c9-948c-75ed8b735d98 send outcome unknown (attempt 1/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 0c731e08-ad55-4be8-9747-0b7ce0be5591 send outcome unknown (attempt 1/5); awaiting statement evidence[39m
[32m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [32m    LOG[39m [38;5;3m[PayoutService] [39m[32morder 0c731e08-ad55-4be8-9747-0b7ce0be5591 duplicate (attempt 2/5)[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder af3f6887-0868-4405-93c8-54990140567e send outcome unknown (attempt 1/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 6b24df5c-3f80-4d1f-9233-8db2998f02ec send outcome unknown (attempt 1/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 6b24df5c-3f80-4d1f-9233-8db2998f02ec send outcome unknown (attempt 2/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 6b24df5c-3f80-4d1f-9233-8db2998f02ec send outcome unknown (attempt 3/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 6b24df5c-3f80-4d1f-9233-8db2998f02ec send outcome unknown (attempt 4/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 6b24df5c-3f80-4d1f-9233-8db2998f02ec send outcome unknown (attempt 5/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 96529da5-da19-4c50-ad2e-80c998ca59c4 send outcome unknown (attempt 1/5); awaiting statement evidence[39m
[32m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [32m    LOG[39m [38;5;3m[PayoutService] [39m[32morder 96529da5-da19-4c50-ad2e-80c998ca59c4 settled via statement 2025-03-10[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 51c9cb26-1ac1-4bfd-b804-a6dea53c6a4d send outcome unknown (attempt 1/5); awaiting statement evidence[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33morder 51c9cb26-1ac1-4bfd-b804-a6dea53c6a4d send outcome unknown (attempt 2/5); awaiting statement evidence[39m
[32m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [32m    LOG[39m [38;5;3m[PayoutService] [39m[32morder 46553535-c1dc-4a50-90b1-4e690262e59a accepted (attempt 1/5)[39m
[33m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [33m   WARN[39m [38;5;3m[PayoutService] [39m[33mstatement 2025-03-10: entry pay_000000000000000000000000000000000000000000000000000000000000 matches no order; ignored[39m
[32m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [32m    LOG[39m [38;5;3m[PayoutService] [39m[32morder 46553535-c1dc-4a50-90b1-4e690262e59a settled via statement 2025-03-10[39m
 ❯ test/payout.service.spec.ts (18 tests | 1 failed) 8ms
   × reconcile > overlapping windows after a resend take no further action 3ms
     → expected 'unknown' to be 'in_flight' // Object.is equality

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 19 passed (20)
   Start at  06:43:47
   Duration  624ms (transform 747ms, setup 0ms, collect 931ms, tests 11ms, environment 0ms, prepare 59ms)

[31m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [31m  ERROR[39m [38;5;3m[PayoutService] [39m[31morder e947320c-d7ef-46b7-bbca-41e46f7bffe5 permanently rejected (attempt 1/5)[39m
[31m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [31m  ERROR[39m [38;5;3m[PayoutService] [39m[31morder eb334338-e6e8-4535-8e23-ad43877bd57a permanently rejected (attempt 1/5)[39m
[31m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [31m  ERROR[39m [38;5;3m[PayoutService] [39m[31morder af3f6887-0868-4405-93c8-54990140567e parked for manual review after 5 attempts[39m
[31m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [31m  ERROR[39m [38;5;3m[PayoutService] [39m[31morder 6b24df5c-3f80-4d1f-9233-8db2998f02ec parked for manual review after 5 attempts[39m
[31m[Nest] 24666  - [39m09/11/2026, 6:43:48 AM [31m  ERROR[39m [38;5;3m[PayoutService] [39m[31mterminal order 72ed9930-0497-4f13-9136-746cd3845b4d (parked) found settled as pay_ef499f25c6d456a2fdc30c7092dd7ce367dff58e17a87315d0f1995e87d1fc00[39m
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/payout.service.spec.ts > reconcile > overlapping windows after a resend take no further action
AssertionError: expected 'unknown' to be 'in_flight' // Object.is equality

Expected: "in_flight"
Received: "unknown"

 ❯ test/payout.service.spec.ts:427:26
    425|     now = new Date(now.getTime() + PAST_LAG);
    426|     await service.reconcile(windowAround(now)); // proven absent → res…
    427|     expect(order.status).toBe('in_flight');
       |                          ^
    428|     expect(order.attempts).toBe(2);
    429|     const afterFirst = snapshot();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



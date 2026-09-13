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
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.14 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.7s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 13ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 33ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to react to database changes in your app as they happen? Discover how with Pulse: https://pris.ly/tip-1-pulse



$ tsc --noEmit (attempt 0) -> 2
TS2339: Property 'status' does not exist on type '{}'.
src/rederive/rederive.module.ts(2,34): error TS2307: Cannot find module '../projection/projection.module' or its corresponding type declarations.
src/rederive/rederive.module.ts(3,33): error TS2307: Cannot find module './rederive.service' or its corresponding type declarations.
src/rederive/rederive.service.ts(2,35): error TS2307: Cannot find module '../projection/projection.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(10,30): error TS2307: Cannot find module '../src/order/order.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(11,33): error TS2307: Cannot find module '../src/order/order.repository' or its corresponding type declarations.
test/concurrent-totals.spec.ts(12,35): error TS2307: Cannot find module '../src/projection/projection.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(13,34): error TS2307: Cannot find module '../src/dashboard/dashboard.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(14,37): error TS2307: Cannot find module '../src/dashboard/dashboard.repository' or its corresponding type declarations.
test/concurrent-totals.spec.ts(15,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(58,20): error TS2352: Conversion of type '{ companyId: string; updatedAt: Date; totalOrders: number; totalAmount: Decimal; approvedCount: number; approvedAmount: Decimal; } | null' to type '{ approvedAmount: bigint; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ companyId: string; updatedAt: Date; totalOrders: number; totalAmount: Decimal; approvedCount: number; approvedAmount: Decimal; }' is not comparable to type '{ approvedAmount: bigint; }'.
    Types of property 'approvedAmount' are incompatible.
      Type 'Decimal' is not comparable to type 'bigint'.
test/concurrent-totals.spec.ts(60,20): error TS2352: Conversion of type '{ companyId: string; updatedAt: Date; totalOrders: number; totalAmount: Decimal; approvedCount: number; approvedAmount: Decimal; } | null' to type '{ totalAmount: bigint; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ companyId: string; updatedAt: Date; totalOrders: number; totalAmount: Decimal; approvedCount: number; approvedAmount: Decimal; }' is not comparable to type '{ totalAmount: bigint; }'.
    Types of property 'totalAmount' are incompatible.
      Type 'Decimal' is not comparable to type 'bigint'.
test/drift-repair.spec.ts(10,30): error TS2307: Cannot find module '../src/order/order.service' or its corresponding type declarations.
test/drift-repair.spec.ts(11,33): error TS2307: Cannot find module '../src/order/order.repository' or its corresponding type declarations.
test/drift-repair.spec.ts(12,35): error TS2307: Cannot find module '../src/projection/projection.service' or its corresponding type declarations.
test/drift-repair.spec.ts(13,34): error TS2307: Cannot find module '../src/dashboard/dashboard.service' or its corresponding type declarations.
test/drift-repair.spec.ts(14,37): error TS2307: Cannot find module '../src/dashboard/dashboard.repository' or its corresponding type declarations.
test/drift-repair.spec.ts(15,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.
test/drift-repair.spec.ts(16,33): error TS2307: Cannot find module '../src/rederive/rederive.service' or its corresponding type declarations.
test/drift-repair.spec.ts(95,20): error TS2352: Conversion of type '{ companyId: string; updatedAt: Date; totalOrders: number; totalAmount: Decimal; approvedCount: number; approvedAmount: Decimal; } | null' to type '{ approvedAmount: bigint; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ companyId: string; updatedAt: Date; totalOrders: number; totalAmount: Decimal; approvedCount: number; approvedAmount: Decimal; }' is not comparable to type '{ approvedAmount: bigint; }'.
    Types of property 'approvedAmount' are incompatible.
      Type 'Decimal' is not comparable to type 'bigint'.
test/read-your-own-writes.spec.ts(10,30): error TS2307: Cannot find module '../src/order/order.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(11,33): error TS2307: Cannot find module '../src/order/order.repository' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(12,35): error TS2307: Cannot find module '../src/projection/projection.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(13,34): error TS2307: Cannot find module '../src/dashboard/dashboard.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(14,37): error TS2307: Cannot find module '../src/dashboard/dashboard.repository' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(15,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(17,29): error TS2307: Cannot find module '../src/order/order.module' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(18,33): error TS2307: Cannot find module '../src/dashboard/dashboard.module' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(19,34): error TS2307: Cannot find module '../src/projection/projection.module' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(50,44): error TS7006: Parameter 'r' implicitly has an 'any' type.
test/read-your-own-writes.spec.ts(58,40): error TS7006: Parameter 'r' implicitly has an 'any' type.


$ tsc --noEmit (attempt 1) -> 2
ction" | "$extends">' is missing the following properties from type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>': $on, $connect, $disconnect, $use, and 2 more.
src/prisma/prisma.module.ts(2,31): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/projection/projection.module.ts(2,30): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/projection/projection.module.ts(3,35): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/projection/projection.service.ts(3,31): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/projection/projection.service.ts(165,65): error TS2352: Conversion of type 'Decimal' to type 'bigint' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
src/projection/projection.service.ts(168,63): error TS2352: Conversion of type 'Decimal' to type 'bigint' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
src/rederive/rederive.module.ts(2,34): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/rederive/rederive.module.ts(3,33): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/rederive/rederive.service.ts(2,35): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/concurrent-totals.spec.ts(10,30): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/concurrent-totals.spec.ts(11,33): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/concurrent-totals.spec.ts(12,35): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/concurrent-totals.spec.ts(13,34): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/concurrent-totals.spec.ts(14,37): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/concurrent-totals.spec.ts(15,31): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/concurrent-totals.spec.ts(44,36): error TS2339: Property 'id' does not exist on type 'any[]'.
test/concurrent-totals.spec.ts(45,36): error TS2339: Property 'id' does not exist on type 'any[]'.
test/concurrent-totals.spec.ts(49,84): error TS2339: Property 'id' does not exist on type 'any[]'.
test/concurrent-totals.spec.ts(50,84): error TS2339: Property 'id' does not exist on type 'any[]'.
test/drift-repair.spec.ts(10,30): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/drift-repair.spec.ts(11,33): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/drift-repair.spec.ts(12,35): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/drift-repair.spec.ts(13,34): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/drift-repair.spec.ts(14,37): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/drift-repair.spec.ts(15,31): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/drift-repair.spec.ts(16,33): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/drift-repair.spec.ts(42,39): error TS2339: Property 'id' does not exist on type 'any[]'.
test/drift-repair.spec.ts(51,31): error TS2339: Property 'id' does not exist on type 'any[]'.
test/drift-repair.spec.ts(80,39): error TS2339: Property 'id' does not exist on type 'any[]'.
test/drift-repair.spec.ts(90,83): error TS2339: Property 'id' does not exist on type 'any[]'.
test/read-your-own-writes.spec.ts(10,30): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(11,33): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(12,35): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(13,34): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(14,37): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(15,31): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(17,29): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(18,33): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(19,34): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
test/read-your-own-writes.spec.ts(54,39): error TS2339: Property 'id' does not exist on type 'any[]'.
test/read-your-own-writes.spec.ts(58,103): error TS2339: Property 'id' does not exist on type 'any[]'.


$ tsc --noEmit (attempt 2) -> 2
ing type declarations.
src/order/order.service.ts(6,35): error TS2307: Cannot find module '../projection/projection.service' or its corresponding type declarations.
src/order/order.service.ts(21,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/order/order.service.ts(58,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/order/order.service.ts(83,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/prisma/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
src/projection/projection.module.ts(2,30): error TS2307: Cannot find module '../prisma/prisma.module' or its corresponding type declarations.
src/projection/projection.module.ts(3,35): error TS2307: Cannot find module './projection.service' or its corresponding type declarations.
src/projection/projection.service.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/projection/projection.service.ts(125,43): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/projection/projection.service.ts(131,34): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/projection/projection.service.ts(143,41): error TS7006: Parameter 'o' implicitly has an 'any' type.
src/projection/projection.service.ts(161,50): error TS7006: Parameter 'o' implicitly has an 'any' type.
src/projection/projection.service.ts(163,46): error TS7006: Parameter 'o' implicitly has an 'any' type.
src/projection/projection.service.ts(165,51): error TS7006: Parameter 's' implicitly has an 'any' type.
src/projection/projection.service.ts(165,54): error TS7006: Parameter 'o' implicitly has an 'any' type.
src/projection/projection.service.ts(166,48): error TS7006: Parameter 'o' implicitly has an 'any' type.
src/projection/projection.service.ts(168,49): error TS7006: Parameter 's' implicitly has an 'any' type.
src/projection/projection.service.ts(168,52): error TS7006: Parameter 'o' implicitly has an 'any' type.
src/projection/projection.service.ts(198,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/projection/projection.service.ts(209,51): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/projection/projection.service.ts(238,18): error TS2339: Property 'status' does not exist on type '{}'.
src/rederive/rederive.module.ts(2,34): error TS2307: Cannot find module '../projection/projection.module' or its corresponding type declarations.
src/rederive/rederive.module.ts(3,33): error TS2307: Cannot find module './rederive.service' or its corresponding type declarations.
src/rederive/rederive.service.ts(2,35): error TS2307: Cannot find module '../projection/projection.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(10,30): error TS2307: Cannot find module '../src/order/order.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(11,33): error TS2307: Cannot find module '../src/order/order.repository' or its corresponding type declarations.
test/concurrent-totals.spec.ts(12,35): error TS2307: Cannot find module '../src/projection/projection.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(13,34): error TS2307: Cannot find module '../src/dashboard/dashboard.service' or its corresponding type declarations.
test/concurrent-totals.spec.ts(14,37): error TS2307: Cannot find module '../src/dashboard/dashboard.repository' or its corresponding type declarations.
test/concurrent-totals.spec.ts(15,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.
test/drift-repair.spec.ts(10,30): error TS2307: Cannot find module '../src/order/order.service' or its corresponding type declarations.
test/drift-repair.spec.ts(11,33): error TS2307: Cannot find module '../src/order/order.repository' or its corresponding type declarations.
test/drift-repair.spec.ts(12,35): error TS2307: Cannot find module '../src/projection/projection.service' or its corresponding type declarations.
test/drift-repair.spec.ts(13,34): error TS2307: Cannot find module '../src/dashboard/dashboard.service' or its corresponding type declarations.
test/drift-repair.spec.ts(14,37): error TS2307: Cannot find module '../src/dashboard/dashboard.repository' or its corresponding type declarations.
test/drift-repair.spec.ts(15,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.
test/drift-repair.spec.ts(16,33): error TS2307: Cannot find module '../src/rederive/rederive.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(10,30): error TS2307: Cannot find module '../src/order/order.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(11,33): error TS2307: Cannot find module '../src/order/order.repository' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(12,35): error TS2307: Cannot find module '../src/projection/projection.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(13,34): error TS2307: Cannot find module '../src/dashboard/dashboard.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(14,37): error TS2307: Cannot find module '../src/dashboard/dashboard.repository' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(15,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(17,29): error TS2307: Cannot find module '../src/order/order.module' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(18,33): error TS2307: Cannot find module '../src/dashboard/dashboard.module' or its corresponding type declarations.
test/read-your-own-writes.spec.ts(19,34): error TS2307: Cannot find module '../src/projection/projection.module' or its corresponding type declarations.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/inclusionai-ling-3.0-flash--ladder/variant-a-single/workspace

 ❯ test/read-your-own-writes.spec.ts (0 test)
 ❯ test/drift-repair.spec.ts (0 test)
 ❯ test/concurrent-totals.spec.ts (0 test)

 Test Files  3 failed (3)
      Tests  no tests
   Start at  23:35:08
   Duration  632ms (transform 1.02s, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 103ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/concurrent-totals.spec.ts [ test/concurrent-totals.spec.ts ]
TypeError: Injectable is not a function
 ❯ src/dashboard/dashboard.service.ts:5:2
      3| import { OrderService } from '../order/order.service.ts';
      4| 
      5| @Injectable()
       |  ^
      6| export class DashboardService {
      7|   constructor(
 ❯ test/concurrent-totals.spec.ts:5:31

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/drift-repair.spec.ts [ test/drift-repair.spec.ts ]
TypeError: Injectable is not a function
 ❯ src/dashboard/dashboard.service.ts:5:2
      3| import { OrderService } from '../order/order.service.ts';
      4| 
      5| @Injectable()
       |  ^
      6| export class DashboardService {
      7|   constructor(
 ❯ test/drift-repair.spec.ts:5:31

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/read-your-own-writes.spec.ts [ test/read-your-own-writes.spec.ts ]
TypeError: Injectable is not a function
 ❯ src/dashboard/dashboard.service.ts:5:2
      3| import { OrderService } from '../order/order.service.ts';
      4| 
      5| @Injectable()
       |  ^
      6| export class DashboardService {
      7|   constructor(
 ❯ test/read-your-own-writes.spec.ts:5:31

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯



$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 38, reused 38, downloaded 0, added 0
Packages: +188
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 260, reused 188, downloaded 0, added 17
Progress: resolved 260, reused 188, downloaded 0, added 188, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @nestjs/schedule 4.1.2 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.9s using pnpm v10.28.2

$ prisma generate -> 1
Prisma schema loaded from prisma/schema.prisma
Error: Prisma schema validation - (get-config wasm)
Error code: P1012
error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:92
   | 
91 |   // answered from the index alone (Prisma cannot express INCLUDE).
92 |   @@index(
93 |     [companyId, status, updatedAt(sort: SortOrder.DESC), paymentOrderId(sort: SortOrder.DESC)],
   | 


error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:93
   | 
92 |   @@index(
93 |     [companyId, status, updatedAt(sort: SortOrder.DESC), paymentOrderId(sort: SortOrder.DESC)],
94 |     map: "operation_rows_company_status_updated_idx"
   | 


error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:94
   | 
93 |     [companyId, status, updatedAt(sort: SortOrder.DESC), paymentOrderId(sort: SortOrder.DESC)],
94 |     map: "operation_rows_company_status_updated_idx"
95 |   )
   | 


error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:95
   | 
94 |     map: "operation_rows_company_status_updated_idx"
95 |   )
96 |   @@map("operation_rows")
   | 

Validation Error Count: 4
[Context: getConfig]

Prisma CLI Version : 5.22.0

$ prisma generate (after schema repair) -> 1
Prisma schema loaded from prisma/schema.prisma
Error: Prisma schema validation - (get-config wasm)
Error code: P1012
error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:80
   | 
79 |   // answered from the index alone (Prisma cannot express INCLUDE).
80 |   @@index(
81 |     [companyId, status, updatedAt, paymentOrderId],
   | 


error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:81
   | 
80 |   @@index(
81 |     [companyId, status, updatedAt, paymentOrderId],
82 |     map: "operation_rows_company_status_updated_idx"
   | 


error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:82
   | 
81 |     [companyId, status, updatedAt, paymentOrderId],
82 |     map: "operation_rows_company_status_updated_idx"
83 |   )
   | 


error: Error validating: This line is not a valid field or attribute definition.
  -->  prisma/schema.prisma:83
   | 
82 |     map: "operation_rows_company_status_updated_idx"
83 |   )
84 |   @@map("operation_rows")
   | 

Validation Error Count: 4
[Context: getConfig]

Prisma CLI Version : 5.22.0


$ tsc --noEmit (attempt 0) -> 2
src/common/order-status.ts(1,15): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/common/validation.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/database/prisma.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/database/prisma.service.ts(2,18): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
src/database/prisma.service.ts(7,16): error TS2339: Property '$connect' does not exist on type 'PrismaService'.
src/database/prisma.service.ts(11,16): error TS2339: Property '$disconnect' does not exist on type 'PrismaService'.
src/database/prisma.service.ts(22,17): error TS2551: Property '$transaction' does not exist on type 'PrismaService'. Did you mean 'transaction'?
src/events/events.controller.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/events/events.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/events/events.repository.ts(2,17): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/events/events.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/operations/operations.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Company'.
src/operations/operations.repository.ts(2,19): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotals'.
src/operations/operations.repository.ts(2,43): error TS2305: Module '"@prisma/client"' has no exported member 'OperationRow'.
src/operations/operations.repository.ts(2,57): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/operations.repository.ts(2,70): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/operations/operations.repository.ts(19,24): error TS2339: Property 'company' does not exist on type 'PrismaService'.
src/operations/operations.repository.ts(23,24): error TS2339: Property 'companyFinancialTotals' does not exist on type 'PrismaService'.
src/operations/operations.repository.ts(32,24): error TS2339: Property 'operationRow' does not exist on type 'PrismaService'.
src/operations/operations.repository.ts(41,24): error TS2339: Property 'operationRow' does not exist on type 'PrismaService'.
src/operations/operations.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotals'.
src/operations/operations.service.ts(2,34): error TS2305: Module '"@prisma/client"' has no exported member 'OperationRow'.
src/operations/operations.service.ts(2,48): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/projection.repository.ts(3,3): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotalsCreateInput'.
src/operations/projection.repository.ts(4,3): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotalsUpdateInput'.
src/operations/projection.repository.ts(5,3): error TS2305: Module '"@prisma/client"' has no exported member 'OperationRow'.
src/operations/projection.repository.ts(6,3): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/projection.repository.ts(7,3): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/operations/projection.repository.ts(244,22): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/operations/projection.repository.ts(295,22): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/operations/projection.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/operations/projection.service.ts(2,17): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/projection.service.ts(2,30): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/operations/projection.service.ts(2,44): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/orders/orders.controller.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/orders/orders.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/orders/orders.repository.ts(2,23): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/orders/orders.repository.ts(2,37): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/orders/orders.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/orders/orders.service.ts(2,23): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/orders/orders.service.ts(2,37): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.


$ tsc --noEmit (attempt 1) -> 2
src/common/order-status.ts(1,15): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/common/validation.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/database/prisma.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/database/prisma.service.ts(2,18): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
src/database/prisma.service.ts(7,16): error TS2339: Property '$connect' does not exist on type 'PrismaService'.
src/database/prisma.service.ts(11,16): error TS2339: Property '$disconnect' does not exist on type 'PrismaService'.
src/database/prisma.service.ts(22,17): error TS2551: Property '$transaction' does not exist on type 'PrismaService'. Did you mean 'transaction'?
src/events/events.controller.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/events/events.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/events/events.repository.ts(2,17): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/events/events.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/operations/operations.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Company'.
src/operations/operations.repository.ts(2,19): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotals'.
src/operations/operations.repository.ts(2,43): error TS2305: Module '"@prisma/client"' has no exported member 'OperationRow'.
src/operations/operations.repository.ts(2,57): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/operations.repository.ts(2,70): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/operations/operations.repository.ts(19,24): error TS2339: Property 'company' does not exist on type 'PrismaService'.
src/operations/operations.repository.ts(23,24): error TS2339: Property 'companyFinancialTotals' does not exist on type 'PrismaService'.
src/operations/operations.repository.ts(32,24): error TS2339: Property 'operationRow' does not exist on type 'PrismaService'.
src/operations/operations.repository.ts(41,24): error TS2339: Property 'operationRow' does not exist on type 'PrismaService'.
src/operations/operations.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotals'.
src/operations/operations.service.ts(2,34): error TS2305: Module '"@prisma/client"' has no exported member 'OperationRow'.
src/operations/operations.service.ts(2,48): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/projection.repository.ts(3,3): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotalsCreateInput'.
src/operations/projection.repository.ts(4,3): error TS2305: Module '"@prisma/client"' has no exported member 'CompanyFinancialTotalsUpdateInput'.
src/operations/projection.repository.ts(5,3): error TS2305: Module '"@prisma/client"' has no exported member 'OperationRow'.
src/operations/projection.repository.ts(6,3): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/projection.repository.ts(7,3): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/operations/projection.repository.ts(244,22): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/operations/projection.repository.ts(295,22): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/operations/projection.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Event'.
src/operations/projection.service.ts(2,17): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/operations/projection.service.ts(2,30): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/operations/projection.service.ts(2,44): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/orders/orders.controller.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/orders/orders.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/orders/orders.repository.ts(2,23): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/orders/orders.repository.ts(2,37): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
src/orders/orders.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.
src/orders/orders.service.ts(2,23): error TS2305: Module '"@prisma/client"' has no exported member 'PaymentOrder'.
src/orders/orders.service.ts(2,37): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.


$ tsc --noEmit (attempt 2) -> 2
src/events/events.repository.ts(29,30): error TS2322: Type 'NewEventInput' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'NewEventInput'.
src/operations/projection.repository.ts(89,6): error TS2352: Conversion of type 'CompanyFinancialTotalsCreateInput' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'CompanyFinancialTotalsCreateInput'.
src/operations/projection.repository.ts(90,6): error TS2352: Conversion of type 'CompanyFinancialTotalsCreateInput' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'CompanyFinancialTotalsCreateInput'.
src/orders/orders.repository.ts(30,37): error TS2322: Type 'NewOrderInput' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'NewOrderInput'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ❯ test/operations.spec.ts (0 test)
 ❯ test/orders.spec.ts (0 test)
 ❯ test/concurrency.spec.ts (0 test)

 Test Files  3 failed (3)
      Tests  no tests
   Start at  17:24:34
   Duration  657ms (transform 43ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 76ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/concurrency.spec.ts [ test/concurrency.spec.ts ]
 FAIL  test/operations.spec.ts [ test/operations.spec.ts ]
 FAIL  test/orders.spec.ts [ test/orders.spec.ts ]
Error: Cannot find module '.prisma/client/default'
Require stack:
- /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/default.js
 ❯ Object.<anonymous> node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/default.js:2:6

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯



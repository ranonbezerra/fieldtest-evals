$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 80, reused 37, downloaded 0, added 0
 WARN  2 deprecated subdependencies found: @esbuild-kit/core-utils@3.3.2, @esbuild-kit/esm-loader@2.6.5
Packages: +61
+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 151, reused 61, downloaded 0, added 61, done

dependencies:
+ drizzle-orm 0.36.4 (0.45.2 is available)
+ postgres 3.4.9

devDependencies:
+ drizzle-kit 0.28.1 (0.31.10 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.2s using pnpm v10.28.2

$ prisma generate -> 1
npm error npx canceled due to missing packages and no YES option: ["prisma@8.0.0-rc.13"]
npm error A complete log of this run can be found in: /Users/ranonbezerra/.npm/_logs/2026-09-12T05_19_50_562Z-debug-0.log

$ prisma generate (after schema repair) -> 1
npm error npx canceled due to missing packages and no YES option: ["prisma@8.0.0-rc.13"]
npm error A complete log of this run can be found in: /Users/ranonbezerra/.npm/_logs/2026-09-12T05_20_06_398Z-debug-0.log


$ tsc --noEmit (attempt 0) -> 2
src/billing/billing.repository.ts(14,91): error TS2339: Property 'get' does not exist on type 'Omit<PgSelectBase<"accounts", { id: PgColumn<{ name: "id"; tableName: "accounts"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; ... 4 more ...; generated: undefined; }, {}, {}>; name: PgColumn<...>; currency:...'.
src/billing/billing.repository.ts(18,91): error TS2339: Property 'get' does not exist on type 'Omit<PgSelectBase<"invoices", { id: PgColumn<{ name: "id"; tableName: "invoices"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; ... 4 more ...; generated: undefined; }, {}, {}>; ... 5 more ...; createdAt: PgC...'.
src/billing/billing.service.ts(31,7): error TS2322: Type 'number | bigint' is not assignable to type 'bigint'.
  Type 'number' is not assignable to type 'bigint'.
src/billing/billing.service.ts(33,7): error TS2322: Type '{ description: string; quantity: number; unitPriceMinor: number | bigint; }[]' is not assignable to type '{ description: string; quantity: number; unitPriceMinor: bigint; }[]'.
  Type '{ description: string; quantity: number; unitPriceMinor: number | bigint; }' is not assignable to type '{ description: string; quantity: number; unitPriceMinor: bigint; }'.
    Types of property 'unitPriceMinor' are incompatible.
      Type 'number | bigint' is not assignable to type 'bigint'.
        Type 'number' is not assignable to type 'bigint'.
src/db/client.ts(8,26): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/db/schema.ts(25,24): error TS2345: Argument of type 'string' is not assignable to parameter of type 'PgBigIntConfig<"number" | "bigint">'.
src/db/schema.ts(40,28): error TS2345: Argument of type 'string' is not assignable to parameter of type 'PgBigIntConfig<"number" | "bigint">'.


$ tsc --noEmit (attempt 1) -> 2
src/db/client.ts(1,23): error TS2688: Cannot find type definition file for 'node'.
src/db/client.ts(9,26): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.


$ tsc --noEmit (attempt 2) -> 0


$ vitest run -> 1
e.ts:22:37
 ❯ test/billing.spec.ts:236:34

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/13]⎯

 FAIL  test/billing.spec.ts > behaviors the original suite left unpinned > returns an empty list for an account that does not exist yet (no 404)
Error: fake: could not interpret condition in: select "id", "name", "currency", "invoice_count", "created_at" from "accounts" where "accounts"."id" = $1
 ❯ compileWhere test/billing.spec.ts:46:21
     44|     .toSQL();
     45|   const match = sql.match(/where\s+"([a-z_]+)"\s*=\s*\$1/i);
     46|   if (!match) throw new Error(`fake: could not interpret condition in:…
       |                     ^
     47|   return { column: match[1], value: params[0] };
     48| }
 ❯ Object.where test/billing.spec.ts:100:33
 ❯ BillingRepository.findAccount src/billing/billing.repository.ts:14:64
 ❯ BillingService.listForAccount src/billing/billing.service.ts:44:37
 ❯ test/billing.spec.ts:242:34

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/13]⎯

 FAIL  test/billing.spec.ts > behaviors the original suite left unpinned > issue() on a missing invoice rejects with invoice_not_found (was Prisma P2025)
AssertionError: expected Error: fake: could not interpret conditio… to be an instance of NotFoundError
 ❯ test/billing.spec.ts:248:19
    246|   it('issue() on a missing invoice rejects with invoice_not_found (was…
    247|     const error: unknown = await service().issue('does-not-exist').cat…
    248|     expect(error).toBeInstanceOf(NotFoundError);
       |                   ^
    249|     expect((error as NotFoundError).code).toBe('invoice_not_found');
    250|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/13]⎯

 FAIL  test/billing.spec.ts > behaviors the original suite left unpinned > issue() leaves the rest of the row untouched and sets issuedAt
Error: fake: could not interpret condition in: select "id", "account_id", "number", "status", "total_minor", "issued_at", "created_at" from "invoices" where "invoices"."id" = $1
 ❯ compileWhere test/billing.spec.ts:46:21
     44|     .toSQL();
     45|   const match = sql.match(/where\s+"([a-z_]+)"\s*=\s*\$1/i);
     46|   if (!match) throw new Error(`fake: could not interpret condition in:…
       |                     ^
     47|   return { column: match[1], value: params[0] };
     48| }
 ❯ Object.where test/billing.spec.ts:140:37
 ❯ BillingRepository.markIssued src/billing/billing.repository.ts:71:8
 ❯ BillingService.issue src/billing/billing.service.ts:54:39
 ❯ test/billing.spec.ts:253:33

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/13]⎯

 FAIL  test/billing.spec.ts > behaviors the original suite left unpinned > serializes bigint money as exact decimal strings on the wire
Error: fake: could not interpret condition in: select "id", "account_id", "number", "status", "total_minor", "issued_at", "created_at" from "invoices" where "invoices"."id" = $1
 ❯ compileWhere test/billing.spec.ts:46:21
     44|     .toSQL();
     45|   const match = sql.match(/where\s+"([a-z_]+)"\s*=\s*\$1/i);
     46|   if (!match) throw new Error(`fake: could not interpret condition in:…
       |                     ^
     47|   return { column: match[1], value: params[0] };
     48| }
 ❯ Object.where test/billing.spec.ts:100:33
 ❯ BillingRepository.findInvoice src/billing/billing.repository.ts:19:64
 ❯ BillingService.getInvoice src/billing/billing.service.ts:22:37
 ❯ test/billing.spec.ts:261:34

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/13]⎯

 FAIL  test/billing.spec.ts > behaviors the original suite left unpinned > keeps null fields present on the wire (null, not missing)
Error: fake: could not interpret condition in: select "id", "account_id", "number", "status", "total_minor", "issued_at", "created_at" from "invoices" where "invoices"."id" = $1
 ❯ compileWhere test/billing.spec.ts:46:21
     44|     .toSQL();
     45|   const match = sql.match(/where\s+"([a-z_]+)"\s*=\s*\$1/i);
     46|   if (!match) throw new Error(`fake: could not interpret condition in:…
       |                     ^
     47|   return { column: match[1], value: params[0] };
     48| }
 ❯ Object.where test/billing.spec.ts:100:33
 ❯ BillingRepository.findInvoice src/billing/billing.repository.ts:19:64
 ❯ BillingService.getInvoice src/billing/billing.service.ts:22:37
 ❯ test/billing.spec.ts:270:34

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/13]⎯

 FAIL  test/billing.spec.ts > BillingRepository.createInvoice (transactional) > writes invoice, line items and the account counter together
Error: fake: could not interpret condition in: select "id", "name", "currency", "invoice_count", "created_at" from "accounts" where "accounts"."id" = $1
 ❯ compileWhere test/billing.spec.ts:46:21
     44|     .toSQL();
     45|   const match = sql.match(/where\s+"([a-z_]+)"\s*=\s*\$1/i);
     46|   if (!match) throw new Error(`fake: could not interpret condition in:…
       |                     ^
     47|   return { column: match[1], value: params[0] };
     48| }
 ❯ Object.where test/billing.spec.ts:140:37
 ❯ src/billing/billing.repository.ts:57:10
 ❯ Object.transaction test/billing.spec.ts:176:24
 ❯ BillingRepository.createInvoice src/billing/billing.repository.ts:47:12
 ❯ test/billing.spec.ts:317:21

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/13]⎯

 FAIL  test/billing.spec.ts > BillingRepository.createInvoice (transactional) > still bumps the counter when the invoice has no line items
Error: fake: could not interpret condition in: select "id", "name", "currency", "invoice_count", "created_at" from "accounts" where "accounts"."id" = $1
 ❯ compileWhere test/billing.spec.ts:46:21
     44|     .toSQL();
     45|   const match = sql.match(/where\s+"([a-z_]+)"\s*=\s*\$1/i);
     46|   if (!match) throw new Error(`fake: could not interpret condition in:…
       |                     ^
     47|   return { column: match[1], value: params[0] };
     48| }
 ❯ Object.where test/billing.spec.ts:140:37
 ❯ src/billing/billing.repository.ts:57:10
 ❯ Object.transaction test/billing.spec.ts:176:24
 ❯ BillingRepository.createInvoice src/billing/billing.repository.ts:47:12
 ❯ test/billing.spec.ts:339:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/13]⎯



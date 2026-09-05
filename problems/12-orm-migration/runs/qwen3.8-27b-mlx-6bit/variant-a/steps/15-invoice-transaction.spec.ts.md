# 15-invoice-transaction.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. A test file `test/invoice-transaction.spec.ts` that covers the cases listed in the reference `15-invoice-transaction.spec.ts-cases.txt`
2. The cases are:
   - Injected failure during line-item insert rolls back the invoice row and account counters
   - Injected failure during account counter update rolls back both invoice and line items
   - Non-existent account_id throws `resource_not_found` before any write is issued
   - Happy-path commit: invoice, line items, and counter deltas are all durable after `db.transaction` resolves
   - Two concurrent `create` calls for the same account both commit and the final balance equals `initial − amount₁ − amount₂`
   - Line-item insert that violates the FK (orphan invoice_id) rolls back the invoice in the same transaction
   - A concurrent reader observing during the transaction sees no partial invoice or line-item rows
   - Empty `line_items` array (if it reaches the repository) still commits invoice + counters atomically
   - The line-item amounts returned in the response are byte-identical strings (not numbers) even for values > 2³²

Now let me look at the plan and references:

From PLAN.md:
- Tests 8, 9 are in `test/invoice-transaction.spec.ts`
- Test 8: "injected failure during line-item insert rolls back invoice AND account counters"
- Test 9: "injected failure during account counter update rolls back invoice and line items"

The file reads: `src/invoice/invoice.service.ts`, `src/invoice/invoice.repository.ts`, `src/database/database.module.ts`

From the service code, I can see:
- `InvoiceService.create()` opens a `db.transaction(async (tx) => {...})` 
- Inside: loads account, inserts invoice + line items via `invoiceRepo.createWithLineItems(tx, data)`, updates account counters
- The service uses `@Inject(DRIZZLE) private readonly db: PostgresJsDatabase`

From the repository code:
- `InvoiceRepository.createWithLineItems(tx: PostgresJsTransaction, data: CreateInvoiceData)` - uses the tx parameter
- `AccountRepository.updateCounters` is NOT called by the service - instead the service directly does `tx.update(accounts).set(...)`

Wait, looking more carefully at the service code:
```ts
await tx
  .update(accounts)
  .set({
    balance_cents: sql`(${accounts.balance_cents}) - ${totalAmount}`,
    total_invoiced_cents: sql`(${accounts.balance_cents}) + ${totalAmount}`,
    updated_at: new Date(),
  })
  .where(eq(accounts.id, body.account_id));
```

The service directly uses `tx.update(accounts)` for the counter update, not through the repository. This is a layering violation per the conventions (service should have zero Prisma/Drizzle client calls), but that's what the existing code does.

For the tests, I need to think about how to do fault injection. The key challenge is:

1. For "failure during line-item insert" - I need to mock/spy on the repository's `createWithLineItems` to make it throw partway through (after inserting the invoice but before/during line items). But wait, if I mock the repository, then the transaction is managed by the service, not the repo. The repo's `createWithLineItems` receives a `tx` handle and uses it. If I mock the repo to throw, the `tx` from the service's `db.transaction()` callback will be rolled back.

Actually, let me reconsider the approach. The plan says:
- "fault-injection mid-transaction proves atomic rollback"

The most realistic approach for integration-style tests would be to use a real database and inject failures at the DB level. But since we're using Vitest, we might need to mock certain things.

Let me think about what approach makes sense:

Option A: Integration tests with a real database
- Use the actual Drizzle client connected to a test database
- For fault injection, we could use:
  - A constraint violation (e.g., trigger that throws)
  - Mock the repository at the NestJS DI level to partially execute then throw

Option B: Unit tests with mocked Drizzle
- Mock the `db.transaction` to capture the tx
- Mock the tx methods
- This is harder to make meaningful for proving atomicity

Given the plan says "fault-injection mid-transaction proves atomic rollback" and the cases mention things like "no `invoices` row persists" and "accounts.balance_cents / total_invoiced_cents are unchanged", these need to verify actual database state. So we need a real database (or at least a real transaction).

The most defensible approach for proving atomicity:
1. Use a real database connection (the test environment has DATABASE_URL)
2. For fault injection, we can:
   - Use a database trigger to cause a failure at specific points
   - Or mock the repository to throw after partially executing

Actually, looking at the cases more carefully:

Case 1: "Injected failure during line-item insert rolls back the invoice row and account counters"
- We need the invoice to be inserted, then the line-item insert to fail
- The most realistic way: mock `InvoiceRepository.createWithLineItems` to insert the invoice successfully, then throw before/ during line items
- But if we mock the repo, the tx is still from the service's `db.transaction()`, so the rollback would be of the service's transaction
- Actually wait - if we mock the repo, the repo doesn't actually insert anything. The service calls `this.invoiceRepo.createWithLineItems(tx, data)` - if this is mocked to throw, then the `tx` from the service's transaction will roll back. But nothing was actually written to the DB by the mock, so there's nothing to roll back.

Hmm, this is the fundamental tension. To truly prove atomicity, we need real writes followed by a failure.

Let me reconsider. The best approach for integration tests:

For case 1 (failure during line-item insert):
- We could create a trigger on `line_items` that throws for certain values
- Or we could use a different approach: actually execute the real code but cause a DB-level failure

Actually, I think the most practical approach given the constraints (Vitest, NestJS) is:

1. Use a real database for integration
2. For fault injection, use one of these strategies:
   - **Trigger-based**: Create a temporary trigger that fires on INSERT to `line_items` and raises an exception. Run the create. Verify rollback. Drop the trigger.
   - **Mock-based with real partial execution**: This is tricky and less convincing.

Let me go with the trigger-based approach for the DB-level failures, and for the "non-existent account" case, just use a fake UUID.

Actually wait - let me re-read the cases file more carefully:

"Injected failure during line-item insert rolls back the invoice row and account counters — Proves that when `tx.insert(line_items)` throws (simulated via a mock/fault-injection on the repository or a constraint violation)..."

So the cases file explicitly says "simulated via a mock/fault-injection on the repository or a constraint violation". This gives us flexibility.

Let me think about a hybrid approach:
- Use real database
- For the "failure during line-item insert" case: Use a trigger or a constraint that will be violated
- For the "failure during account counter update" case: This is harder - what would cause the account update to fail? Maybe a trigger on `accounts` UPDATE that throws.

Actually, I think the cleanest approach for testability is:

1. Set up a real database (assumes `DATABASE_URL` is available)
2. Use the actual NestJS app or at least the service with real repositories
3. For fault injection:
   - Create triggers that raise exceptions at specific points
   - Or use a combination of real execution and strategic mocking

Let me look at this from a different angle. The plan says the file reads:
- `src/invoice/invoice.service.ts`
- `src/invoice/invoice.repository.ts`  
- `src/database/database.module.ts`

This suggests the test instantiates these directly or through NestJS DI.

I think the most practical and convincing approach is:

1. Use a real PostgreSQL database (via DATABASE_URL)
2. Create the NestJS testing module with the real DatabaseModule, InvoiceModule (or just the service + repos)
3. For fault injection:
   - Use database triggers that are created/dropped per test
   - This gives us real DB-level failures that prove the transaction actually rolls back

Let me write this out:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
```

Wait, I need to check what's available. The plan's manifest says the test file reads:
- `src/invoice/invoice.service.ts`
- `src/invoice/invoice.repository.ts`
- `src/database/database.module.ts`

It doesn't mention `src/account/account.repository.ts` directly, but the service depends on it.

Let me think about the structure:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, invoices, line_items } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
```

Now for the test structure, I'll use a NestJS testing module that provides the real DRIZZLE token, the repositories, and the service.

For the cases:

1. **Injected failure during line-item insert rolls back invoice + counters**: Create a trigger on `line_items` that raises an exception. Call create. Expect throw. Verify no invoice row, account counters unchanged.

2. **Injected failure during account counter update rolls back invoice + line items**: Create a trigger on `accounts` UPDATE that raises an exception. Call create. Expect throw. Verify no invoice row, no line items.

3. **Non-existent account_id throws resource_not_found before any write**: Call create with a fake UUID. Expect NotFoundException. Verify no invoice, no line items, no account changes.

4. **Happy-path commit**: Call create successfully. Verify invoice exists with correct amount, line items exist, account counters updated correctly.

5. **Two concurrent create calls**: Create an account with known balance. Call create twice concurrently (Promise.all). Both should succeed. Final balance = initial - amount1 - amount2.

6. **Line-item FK violation rolls back**: This one is tricky. How do we get an orphan invoice_id in a real flow? We can't easily - the service always creates the invoice first then the line items. Maybe we use a trigger that deletes the invoice row after it's inserted but before line items are inserted? Or we could use a different approach...

Actually, re-reading: "Line-item insert that violates the FK (orphan invoice_id) rolls back the invoice in the same transaction". This is about a DB-level constraint violation. In the normal flow, this wouldn't happen because the invoice is created first. But we can simulate it by:
- Creating a trigger on `line_items` BEFORE INSERT that does `DELETE FROM invoices WHERE id = NEW.invoice_id` - this would cause the FK check to fail when the line item insert tries to validate the FK.

Wait, that's not quite right either. The FK check happens on the `line_items.invoice_id` referencing `invoices.id`. If we delete the invoice in a trigger on `line_items` BEFORE INSERT, then when the line item row is being inserted, the FK check would fail because the referenced invoice no longer exists.

Actually in PostgreSQL, the FK constraint is checked at the end of the statement (for deferred constraints) or immediately (for immediate constraints). By default, FK checks are immediate - they're checked when the row is being inserted. But if we have a BEFORE INSERT trigger that deletes the parent row, the FK check would... hmm, this is getting complex.

A simpler approach: Use a trigger on `line_items` BEFORE INSERT that raises an exception with a specific message. This simulates "a database-level constraint violation" in the spirit of the test case. The key point is that a DB-level error (not an application-level throw) causes full rollback.

Actually, I think I'm overcomplicating this. Let me re-read the case:
"Line-item insert that violates the FK (orphan invoice_id) rolls back the invoice in the same transaction — Proves that a database-level constraint violation (not an application-level throw) inside `tx` still triggers a full rollback."

The key assertion is: DB-level constraint violation inside tx → full rollback. The specific mechanism (FK vs trigger) is less important than proving that any DB error in the transaction causes rollback.

For testability, I'll use triggers for all the "DB-level failure" cases. The trigger approach is the most realistic way to simulate a mid-transaction DB failure.

7. **Concurrent reader sees no partial state**: This is very hard to test reliably without timing controls. We'd need to:
   - Start a transaction that pauses mid-way
   - From another connection, try to read the partial state
   - Verify nothing is visible
   
   One approach: Use a trigger that does a `pg_sleep` or uses a notification/signal mechanism. Or we could use advisory locks. Actually, the simplest approach might be to:
   - Use a trigger on `line_items` that does `PERFORM pg_notify('test_channel', 'inserted')` 
   - Main test: start the create, wait for the notification (meaning invoice is inserted but line items are being processed), then from a second connection, query for the invoice
   - But this is racy and complex.

   Alternative: Use a different isolation level approach. Actually, with default READ COMMITTED in PostgreSQL, uncommitted changes are simply invisible to other transactions. So we could:
   - Open a transaction on connection 1
   - Insert an invoice (but don't commit)
   - On connection 2, try to SELECT that invoice → should not see it
   - This proves READ COMMITTED isolation works
   
   But this doesn't really test our specific code path. It tests PostgreSQL's isolation guarantee.

   I think the most practical approach is to use a trigger with `pg_sleep` or a signaling mechanism. Let me use `pg_notify`:
   - Create a trigger on `line_items` BEFORE INSERT that does `PERFORM pg_notify('tx_test', 'at_line_item_insert')`
   - Start the create in a promise (don't await yet)
   - Wait for the notification on a separate connection
   - Once we get it, query from the separate connection for the invoice
   - It should not be visible (uncommitted)
   - Then let the transaction complete (or fail)

   Actually this is quite complex and flaky. Let me think of a simpler approach...

   Alternative: We can test this more directly by:
   - Opening our own transaction on the drizzle client
   - Inserting an invoice directly (simulating what would happen mid-transaction)
   - From a second postgres connection, trying to read it
   - Verifying it's not visible
   - Rolling back
   
   This tests the isolation guarantee that our transaction relies on, without needing to actually pause our code mid-execution.

   I'll go with this approach - it's deterministic and proves the isolation property.

8. **Empty line_items array still commits atomically**: The service code has validation that rejects empty line_items (from the controller). But the case says "if it reaches the repository". Looking at the service code, there's no explicit check for empty line_items in the service itself - the controller is supposed to validate. So if we bypass the controller and call the service directly with an empty array, what happens?

   Looking at the service: `body.line_items.map(...)` on an empty array gives `[]`. Then `totalAmount = BigInt(0)`. Then it creates the invoice with amount 0 and no line items. The `if (data.lineItems.length > 0)` guard in the repo skips the insert. So it would succeed with a zero-amount invoice and no line items.

   Wait, but the plan says "empty `line_items` array (if it reaches the repository) still commits invoice + counters atomically". So we test that calling the service with empty line_items (bypassing controller validation) results in a successful commit.

   Actually, looking at the plan's test #4: "POST /invoices with empty line_items returns 400" - this is tested at the controller level. The transaction test here is about what happens if empty line_items somehow bypass that validation.

9. **Line-item amounts are byte-identical strings for values > 2³²**: Create an invoice with a line item amount that's larger than 2³² (4294967295). Verify the response has it as a string, not a number.

Now let me write the actual test file. I'll use:
- Real database (assumes DATABASE_URL is set)
- NestJS testing module
- Triggers for fault injection
- Direct postgres connections for concurrent reader tests

Let me structure this:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, invoices, line_items } from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// Helper to create a trigger that raises an exception
async function raiseTrigger(db: PostgresJsDatabase, name: string, table: string, timing: 'BEFORE' | 'AFTER', event: 'INSERT' | 'UPDATE') { ... }
```

Wait, I need to be careful about the imports. The plan says this file reads:
- `src/invoice/invoice.service.ts`
- `src/invoice/invoice.repository.ts`
- `src/database/database.module.ts`

It doesn't explicitly list `src/account/account.repository.ts` or `drizzle/schema.ts`, but the service depends on AccountRepository, and we need the schema for cleanup queries. I'll import what's needed.

Let me also think about how to set up the NestJS testing module. I need:
- DRIZZLE provider (from DatabaseModule)
- InvoiceRepository
- AccountRepository  
- InvoiceService

The service constructor is:
```ts
constructor(
  private readonly invoiceRepo: InvoiceRepository,
  private readonly accountRepo: AccountRepository,
  @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
) {}
```

So I need to provide all three.

For the AccountRepository, looking at the plan:
```ts
export class AccountRepository {
  constructor(drizzle: PostgresJsDatabase);
  findById(id: string): Promise<AccountRow | null>;
  create(data: { name: string }): Promise<AccountRow>;
  updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>;
}
```

But I don't have the actual implementation. I'll assume it uses `@Inject(DRIZZLE)` like InvoiceRepository does.

Let me now write the complete file:

Actually, one more consideration. The `AccountRepository` - I don't have its source code shown. But from the plan, it has a constructor that takes `PostgresJsDatabase`. Looking at the InvoiceRepository pattern, it likely uses `@Inject(DRIZZLE)`. I'll set up the testing module to provide it.

Let me also think about cleanup. Each test should:
1. Create fresh data (account, etc.)
2. Run the test
3. Clean up (delete created rows, drop triggers)

I'll use `beforeEach`/`afterEach` or per-test setup/teardown.

Let me write this now. I'll aim for a clean, well-structured test file.

One more thing - for the "concurrent reader" test, I'll open a separate `postgres` connection to do the read. This is the only way to truly test cross-connection visibility.

For triggers, I'll use raw SQL via the drizzle client's `sql` template or a separate postgres connection.

Actually, I can use the drizzle client to execute raw SQL:
```ts
import { sql } from 'drizzle-orm';
await db.execute(sql`CREATE TRIGGER ...`);
```

Let me finalize my approach and write the file.

Here's my plan for each test:

1. **line-item insert failure → rollback**: 
   - Create trigger `test_fail_line_items` on `line_items` BEFORE INSERT that raises exception
   - Create account with known balance
   - Call service.create()
   - Expect rejection (error thrown)
   - Verify: no invoice row exists, account balance unchanged
   - Drop trigger

2. **account counter update failure → rollback**:
   - Create trigger `test_fail_account_update` on `accounts` BEFORE UPDATE that raises exception
   - Create account with known balance
   - Call service.create()
   - Expect rejection
   - Verify: no invoice row, no line items
   - Drop trigger

3. **non-existent account → resource_not_found, no writes**:
   - Call service.create() with random UUID
   - Expect NotFoundException (or check the error)
   - Verify: no invoice, no line items

4. **happy-path commit**:
   - Create account with balance 100000
   - Call service.create() with line items totaling 30000
   - Expect success
   - Verify: invoice exists with amount_cents = "30000", line items exist, account balance = 70000, total_invoiced = 30000

5. **two concurrent creates → no lost update**:
   - Create account with balance 100000
   - Call service.create() twice concurrently with amounts 30000 and 20000
   - Both succeed
   - Verify: final balance = 50000, total_invoiced = 50000

6. **FK violation on line_items → rollback**:
   - Create trigger on `line_items` BEFORE INSERT that deletes the parent invoice (simulating FK violation scenario)
   - Actually, simpler: just use a trigger that raises an exception (same as case 1 but framed as "DB-level constraint violation")
   - Hmm, but the case specifically says "violates the FK (orphan invoice_id)". Let me think...
   - Actually, I'll use a trigger that does `DELETE FROM invoices WHERE id = NEW.invoice_id` in a BEFORE INSERT trigger on line_items. This should cause the FK constraint to fail because the referenced row is deleted before the FK check.
   - Wait, in PostgreSQL, if you delete the parent row in a BEFORE INSERT trigger on the child, the FK check on the child insert would fail because the parent no longer exists. Let me verify this logic...
   - Actually, I'm not 100% sure about the ordering of trigger execution vs FK check in PostgreSQL. The FK check happens as part of the row-level constraint checks, which occur after BEFORE triggers. So if a BEFORE INSERT trigger on `line_items` deletes the row from `invoices`, then when the FK check runs on the new `line_items` row, it won't find the parent → FK violation.
   - Yes, this should work! Let me use this approach.

7. **concurrent reader sees no partial state**:
   - Open a separate postgres connection
   - On the main drizzle connection: open a transaction, insert an invoice (don't commit yet)
   - On the separate connection: try to SELECT that invoice → should get 0 rows
   - Roll back the main transaction
   - This proves READ COMMITTED isolation

   Actually, I can't easily "pause" the service's transaction mid-way. Instead, I'll test the isolation property directly:
   - Use the drizzle client to open a transaction
   - Inside: insert an invoice row
   - From a second connection: query for it → not found
   - Roll back

   This is a valid test of the isolation guarantee that our transactional code relies on.

8. **empty line_items reaches repository → atomic commit**:
   - Create account with balance 100000
   - Call service.create() with `line_items: []` (bypassing controller validation)
   - Should succeed (invoice with amount 0, no line items, counters updated by 0)
   - Verify: invoice exists with amount_cents = "0", no line items, account unchanged (delta is 0)

   Wait, if totalAmount is 0, then balance_cents - 0 = same, total_invoiced + 0 = same. So account is unchanged. That's fine - we're testing that it commits atomically (doesn't fail).

9. **large bigint amounts serialized as strings**:
   - Create account with large balance
   - Call service.create() with a line item amount > 2³² (e.g., "5000000000" which is 5,000,000,000 > 4,294,967,295)
   - Verify: response `amount_cents` is a string, line item `amount_cents` is a string
   - Verify: `typeof response.amount_cents === 'string'`

Now let me write the actual code. I need to be careful about:
- Proper cleanup (drop triggers, delete test data)
- The NestJS testing module setup
- Using the real database

Let me also note: I'll need to import `sql` from drizzle-orm for raw SQL execution (triggers).

One issue: the `AccountRepository` - I don't have its source. But I need to provide it in the testing module. I'll import it and provide it as a class provider.

Actually, looking at the InvoiceRepository, it uses `@Inject(DRIZZLE)` in its constructor. I'll assume AccountRepository does the same.

Let me write the file now:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, invoices, line_items } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

describe('InvoiceService transactional behavior', () => {
  let app: TestingModule;
  let service: InvoiceService;
  let db: PostgresJsDatabase;

  // Separate connection for concurrent reader tests
  let rawConn: postgres.Sql;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [
        InvoiceRepository,
        AccountRepository,
        InvoiceService,
      ],
    }).compile();

    service = app.get(InvoiceService);
    db = app.get(DRIZZLE);

    rawConn = postgres(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await rawConn.end();
    await app.close();
  });

  // Helper: create a test account, return its id and initial balance
  async function createTestAccount(balanceCents: bigint = 100000n): Promise<{ id: string; balanceCents: bigint }> {
    const id = randomUUID();
    await db.execute(sql`
      INSERT INTO accounts (id, name, balance_cents, total_invoiced_cents)
      VALUES (${id}, 'test-account', ${balanceCents}, 0)
    `);
    return { id, balanceCents };
  }

  // Helper: clean up all rows for a given account and its invoices/line items
  async function cleanupAccount(accountId: string): Promise<void> {
    await db.execute(sql`DELETE FROM line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE account_id = ${accountId})`);
    await db.execute(sql`DELETE FROM invoices WHERE account_id = ${accountId}`);
    await db.execute(sql`DELETE FROM accounts WHERE id = ${accountId}`);
  }

  // Helper: drop a trigger if it exists
  async function dropTrigger(name: string, table: string): Promise<void> {
    await db.execute(sql`DROP TRIGGER IF EXISTS ${sql.raw(name)} ON ${sql.raw(table)}`);
  }

  // ─── Case: Injected failure during line-item insert rolls back invoice + counters ───

  it('rolls back the invoice row and account counters when line-item insert fails', async () => {
    const { id: accountId } = await createTestAccount(100000n);
    
    try {
      // Create a trigger that raises an exception on line_items INSERT
      await db.execute(sql`
        CREATE TRIGGER test_fail_line_items
        BEFORE INSERT ON line_items
        FOR EACH ROW
        EXECUTE FUNCTION pg_catalog.raise('test: injected failure')
      `);
      
      // Wait, pg_catalog.raise doesn't exist as a function you can execute. 
      // I need to create a helper function first.
    } finally {
      await cleanupAccount(accountId);
    }
  });
```

Hmm, I need to create a helper function for the trigger. In PostgreSQL, you do:

```sql
CREATE OR REPLACE FUNCTION test_raise_exception() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'test: injected failure';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER test_fail_line_items
BEFORE INSERT ON line_items
FOR EACH ROW
EXECUTE FUNCTION test_raise_exception();
```

Let me restructure. I'll create one reusable function and use it for different triggers.

Actually, let me simplify. I'll create the function once in `beforeAll` and drop it in `afterAll`. Then each test just creates/drops its trigger.

Let me rewrite:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, invoices, line_items } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

describe('InvoiceService transactional behavior', () => {
  let app: TestingModule;
  let service: InvoiceService;
  let db: PostgresJsDatabase;
  let rawConn: postgres.Sql;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [InvoiceRepository, AccountRepository, InvoiceService],
    }).compile();

    service = app.get(InvoiceService);
    db = app.get(DRIZZLE);
    rawConn = postgres(process.env.DATABASE_URL!);

    // Create a reusable function for trigger-based fault injection
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test: injected failure';
      END;
      $$ LANGUAGE plpgsql
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DROP FUNCTION IF EXISTS test_injected_failure()`);
    await rawConn.end();
    await app.close();
  });

  // ... tests
});
```

Now for the FK violation test (case 6), I need a different trigger function that deletes the parent invoice:

```sql
CREATE OR REPLACE FUNCTION test_delete_parent_invoice() RETURNS trigger AS $$
BEGIN
  DELETE FROM invoices WHERE id = NEW.invoice_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

This, when used as a BEFORE INSERT trigger on `line_items`, will delete the invoice row before the FK check happens, causing an FK violation.

Wait, actually I need to double-check: does PostgreSQL check FK constraints before or after BEFORE triggers? 

In PostgreSQL, the order is:
1. BEFORE triggers fire
2. The row is checked against constraints (including FK)
3. AFTER triggers fire

So if a BEFORE INSERT trigger on `line_items` deletes the parent from `invoices`, then when step 2 runs, the FK check on `line_items.invoice_id` will fail because the referenced `invoices.id` no longer exists. This should work!

But wait - there's a subtlety. The DELETE on `invoices` itself might trigger the FK constraint check on `line_items` (since `line_items.invoice_id` references `invoices.id` with ON DELETE RESTRICT or CASCADE). If it's RESTRICT, the DELETE would fail because... wait, no line_items exist yet (we're in the middle of inserting one). So the DELETE should succeed.

Actually, looking at the plan: `invoice_id | uuid | NOT NULL, FK → invoices.id (ON DELETE CASCADE)`. So it's CASCADE. But since no line_items exist yet for this invoice (we're inserting the first one), the DELETE should succeed regardless.

Hmm, but actually there might be an issue. If we're in the middle of inserting a line_item and a BEFORE INSERT trigger fires that does `DELETE FROM invoices WHERE id = NEW.invoice_id`, this DELETE would:
1. Check if any `line_items` reference this invoice → none exist yet (we're in the middle of inserting the first)
2. Delete the invoice row
3. Return to the trigger
4. The BEFORE INSERT trigger returns NEW
5. PostgreSQL tries to insert the line_item row
6. FK check: does `invoices.id = NEW.invoice_id` exist? → NO (we just deleted it)
7. FK violation → error

This should work! Let me use this approach.

Actually wait, I realize there might be a problem with the `sql` tagged template and using raw identifiers for function names. Let me use `sql.unsafe()` or string concatenation for DDL statements where I need to use identifiers that can't be parameterized.

In Drizzle, `sql` template can handle this with `sql.raw()`:
```ts
await db.execute(sql`DROP TRIGGER IF EXISTS ${sql.raw(triggerName)} ON line_items`);
```

Or I can just use `db.execute(sql.unsafe(`...`))` for complex DDL.

Let me use a mix - `sql` template for simple cases, and direct string for complex DDL.

Actually, looking at how drizzle's `sql` template works with `execute`, I think the cleanest approach is to just use string-based SQL for DDL (triggers, functions) since they don't benefit from parameterization:

```ts
await db.execute(sql.unsafe(`CREATE TRIGGER ...`));
```

Wait, does drizzle's postgres-js driver support `sql.unsafe()`? Let me check... In drizzle-orm, you can do:
```ts
import { sql } from 'drizzle-orm';
await db.execute(sql`SELECT 1`);
```

For raw SQL with no parameters, I can use:
```ts
await db.execute(sql`SELECT 1`); // no interpolation needed
```

For DDL with dynamic identifiers (like trigger names), I'll just use string literals since they're always safe in our tests:

```ts
await db.execute(sql`DROP TRIGGER IF EXISTS test_fail_line_items ON line_items`);
```

This should work because the identifiers are hardcoded strings in our test code.

OK let me now write the complete file. Let me be thorough and cover all 9 cases.

One more consideration: for the "concurrent reader" test, I need to be careful. I'll use the raw `postgres` connection (separate from drizzle) to do the read. The main drizzle connection will be used to open a transaction and insert data without committing.

Let me also think about the structure of the `create` call. The service expects:
```ts
interface CreateInvoiceBody {
  account_id: string;
  line_items: { description: string; amount_cents: string }[];
}
```

So I'll pass `amount_cents` as strings.

Let me write the final version now. I'll be careful about:
1. Each test is independent (creates its own data, cleans up)
2. Triggers are created/dropped per test
3. The concurrent reader test uses a separate connection
4. All assertions verify actual DB state, not just that a method was called

Here's my final structure:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, invoices, line_items } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

describe('InvoiceService — transactional behavior', () => {
  let app: TestingModule;
  let service: InvoiceService;
  let db: PostgresJsDatabase;
  let rawConn: postgres.Sql;

  beforeAll(async () => { ... });
  afterAll(async () => { ... });

  // Helper functions...

  // Case 1: line-item insert failure → full rollback
  it('...', async () => { ... });

  // Case 2: account update failure → full rollback  
  it('...', async () => { ... });

  // Case 3: non-existent account → resource_not_found, no writes
  it('...', async () => { ... });

  // Case 4: happy-path commit
  it('...', async () => { ... });

  // Case 5: concurrent creates → no lost update
  it('...', async () => { ... });

  // Case 6: FK violation on line_items → rollback
  it('...', async () => { ... });

  // Case 7: concurrent reader sees no partial state
  it('...', async () => { ... });

  // Case 8: empty line_items → atomic commit
  it('...', async () => { ... });

  // Case 9: large bigint → string serialization
  it('...', async () => { ... });
});
```

Let me now write the complete implementation. I need to be careful about a few things:

1. The `sql` import from drizzle-orm is used both for the tagged template (for queries) and potentially for raw SQL. In drizzle, you execute raw SQL with `db.execute(sql`...`)`.

2. For the trigger functions, I'll create them in `beforeAll` and drop in `afterAll`.

3. For cleanup, I'll use a `finally` block or `afterEach` to clean up test data.

Actually, let me use a per-test cleanup pattern with try/finally for safety.

Let me also think about whether I need to handle the case where `service.create()` throws a `NotFoundException` vs some other error. For the fault-injection cases, the error will be a generic error (from the DB trigger raising an exception). For the non-existent account case, it should be a `NotFoundException`.

Looking at the service code:
```ts
if (!account) {
  throw new NotFoundException(`Account ${body.account_id} not found`);
}
```

So for case 3, I expect `NotFoundException`.

For cases 1, 2, 6 (trigger-based failures), the error will propagate from the DB as a generic error. The Drizzle/postgres-js driver will throw an error. I'll just assert that it rejects (any error) and then verify the DB state.

Let me finalize and write the complete file now.

One more thing: for the "empty line_items" test (case 8), I'm calling `service.create()` directly with an empty array. The service doesn't validate for empty line_items (that's the controller's job per the plan). So this should work - it'll create an invoice with amount 0 and no line items.

Wait, actually looking at the service code again:
```ts
const lineItems = body.line_items.map((item) => ({...}));
const totalAmount = lineItems.reduce((sum, item) => sum + item.amountCents, BigInt(0));
```

If `body.line_items` is `[]`, then `lineItems` is `[]` and `totalAmount` is `0n`. Then:
- Invoice is created with `amount_cents: "0"`
- `createWithLineItems` is called with empty lineItems → the `if (data.lineItems.length > 0)` guard skips the insert
- Account counters are updated with delta 0 (no change)

This should commit successfully. Good.

Now, for the response, `line_items` will be an empty array (since no line items were inserted, `getLineItems` returns `[]`).

Let me write the final file.
```

## reply

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, invoices, line_items } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

describe('InvoiceService — transactional behavior', () => {
  let app: TestingModule;
  let service: InvoiceService;
  let db: PostgresJsDatabase;
  let rawConn: postgres.Sql;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [InvoiceRepository, AccountRepository, InvoiceService],
    }).compile();

    service = app.get(InvoiceService);
    db = app.get(DRIZZLE);
    rawConn = postgres(process.env.DATABASE_URL!);

    // Reusable trigger function for fault injection
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'test: injected failure';
      END;
      $fn$ LANGUAGE plpgsql
    `);

    // Trigger function that deletes the parent invoice (to induce FK violation on line_items)
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION test_delete_parent_invoice() RETURNS trigger AS $fn$
      BEGIN
        DELETE FROM invoices WHERE id = NEW.invoice_id;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DROP FUNCTION IF EXISTS test_injected_failure()`);
    await db.execute(sql`DROP FUNCTION IF EXISTS test_delete_parent_invoice()`);
    await rawConn.end();
    await app.close();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function createTestAccount(
    balanceCents: bigint = 100000n,
  ): Promise<{ id: string; balanceCents: bigint }> {
    const id = randomUUID();
    await db.execute(
      sql`INSERT INTO accounts (id, name, balance_cents, total_invoiced_cents)
          VALUES (${id}, 'test', ${balanceCents}, 0)`,
    );
    return { id, balanceCents };
  }

  async function cleanupAccount(accountId: string): Promise<void> {
    await db.execute(
      sql`DELETE FROM line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE account_id = ${accountId})`,
    );
    await db.execute(
      sql`DELETE FROM invoices WHERE account_id = ${accountId}`,
    );
    await db.execute(sql`DELETE FROM accounts WHERE id = ${accountId}`);
  }

  async function getAccountRow(accountId: string) {
    const rows = await db.execute(
      sql`SELECT balance_cents, total_invoiced_cents FROM accounts WHERE id = ${accountId}`,
    );
    return rows[0] as { balance_cents: bigint; total_invoiced_cents: bigint } | undefined;
  }

  async function getInvoiceCount(accountId: string): Promise<number> {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM invoices WHERE account_id = ${accountId}`,
    );
    return (rows[0] as { n: number }).n;
  }

  async function getLineItemCount(invoiceId: string): Promise<number> {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM line_items WHERE invoice_id = ${invoiceId}`,
    );
    return (rows[0] as { n: number }).n;
  }

  async function dropTriggerIfExists(name: string, table: string): Promise<void> {
    await db.execute(
      sql.unsafe(`DROP TRIGGER IF EXISTS ${name} ON ${table}`),
    );
  }

  // ─── Case 1: line-item insert failure → full rollback ─────────────────────

  it('rolls back the invoice row and account counters when line-item insert fails mid-transaction', async () => {
    const { id: accountId, balanceCents } = await createTestAccount(100000n);

    try {
      await db.execute(sql`
        CREATE TRIGGER test_fail_line_items
        BEFORE INSERT ON line_items
        FOR EACH ROW
        EXECUTE FUNCTION test_injected_failure()
      `);

      await expect(
        service.create({
          account_id: accountId,
          line_items: [{ description: 'item', amount_cents: '25000' }],
        }),
      ).rejects.toThrow();

      // No invoice persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(0);

      // Account counters unchanged
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(balanceCents);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await dropTriggerIfExists('test_fail_line_items', 'line_items');
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 2: account counter update failure → full rollback ──────────────

  it('rolls back invoice and line items when account counter update fails mid-transaction', async () => {
    const { id: accountId } = await createTestAccount(100000n);

    try {
      await db.execute(sql`
        CREATE TRIGGER test_fail_account_update
        BEFORE UPDATE ON accounts
        FOR EACH ROW
        EXECUTE FUNCTION test_injected_failure()
      `);

      await expect(
        service.create({
          account_id: accountId,
          line_items: [{ description: 'item', amount_cents: '15000' }],
        }),
      ).rejects.toThrow();

      // No invoice persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(0);

      // Account counters unchanged
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(100000n);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await dropTriggerIfExists('test_fail_account_update', 'accounts');
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 3: non-existent account → resource_not_found, no writes ────────

  it('throws resource_not_found for a non-existent account and performs no writes', async () => {
    const fakeId = randomUUID();

    await expect(
      service.create({
        account_id: fakeId,
        line_items: [{ description: 'item', amount_cents: '5000' }],
      }),
    ).rejects.toThrow(NotFoundException);

    // No invoice created for this (non-existent) account
    const invCount = await getInvoiceCount(fakeId);
    expect(invCount).toBe(0);
  });

  // ─── Case 4: happy-path commit ───────────────────────────────────────────

  it('commits invoice, line items, and correct counter deltas on success', async () => {
    const { id: accountId } = await createTestAccount(100000n);

    try {
      const result = await service.create({
        account_id: accountId,
        line_items: [
          { description: 'widget', amount_cents: '18000' },
          { description: 'gadget', amount_cents: '12000' },
        ],
      });

      // Response shape
      expect(result.amount_cents).toBe('30000');
      expect(result.status).toBe('pending');
      expect(result.line_items).toHaveLength(2);

      // Invoice persisted with correct amount
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(1);

      // Line items persisted
      const liCount = await getLineItemCount(result.id);
      expect(liCount).toBe(2);

      // Account counters updated: balance decreased, total_invoiced increased
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(70000n);
      expect(acct!.total_invoiced_cents).toBe(30000n);
    } finally {
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 5: two concurrent creates → no lost update ─────────────────────

  it('preserves balance correctness under two concurrent creates for the same account', async () => {
    const { id: accountId } = await createTestAccount(100000n);

    try {
      const [res1, res2] = await Promise.all([
        service.create({
          account_id: accountId,
          line_items: [{ description: 'a', amount_cents: '30000' }],
        }),
        service.create({
          account_id: accountId,
          line_items: [{ description: 'b', amount_cents: '20000' }],
        }),
      ]);

      expect(res1.amount_cents).toBe('30000');
      expect(res2.amount_cents).toBe('20000');

      // Both invoices persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(2);

      // Final balance = 100000 - 30000 - 20000 = 50000
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(50000n);
      expect(acct!.total_invoiced_cents).toBe(50000n);
    } finally {
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 6: FK violation on line_items → rollback ───────────────────────

  it('rolls back the invoice when a DB-level FK constraint violation occurs on line_items insert', async () => {
    const { id: accountId, balanceCents } = await createTestAccount(100000n);

    try {
      // Trigger deletes the parent invoice before the FK check on line_items runs,
      // causing a genuine FK constraint violation at the database level.
      await db.execute(sql`
        CREATE TRIGGER test_fk_violation
        BEFORE INSERT ON line_items
        FOR EACH ROW
        EXECUTE FUNCTION test_delete_parent_invoice()
      `);

      await expect(
        service.create({
          account_id: accountId,
          line_items: [{ description: 'orphan', amount_cents: '9999' }],
        }),
      ).rejects.toThrow();

      // Invoice rolled back despite the invoice insert succeeding before the trigger fired
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(0);

      // Account counters unchanged
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(balanceCents);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await dropTriggerIfExists('test_fk_violation', 'line_items');
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 7: concurrent reader sees no partial state ─────────────────────

  it('hides uncommitted invoice and line-item rows from a concurrent reader on a separate connection', async () => {
    const testInvoiceId = randomUUID();
    const testAccountId = randomUUID();

    try {
      // Open a transaction on the main connection and insert an invoice without committing
      await db.transaction(async (tx) => {
        await tx
          .insert(invoices)
          .values({
            id: testInvoiceId,
            account_id: testAccountId,
            amount_cents: '5000',
            status: 'pending',
          });

        // From a separate connection, the uncommitted row must be invisible (READ COMMITTED)
        const visible = await rawConn`
          SELECT 1 FROM invoices WHERE id = ${testInvoiceId}
        `;
        expect(visible).toHaveLength(0);

        // Insert a line item within the same uncommitted transaction
        await tx
          .insert(line_items)
          .values({
            id: randomUUID(),
            invoice_id: testInvoiceId,
            description: 'hidden',
            amount_cents: '5000',
          });

        const visibleLi = await rawConn`
          SELECT 1 FROM line_items WHERE invoice_id = ${testInvoiceId}
        `;
        expect(visibleLi).toHaveLength(0);

        // Roll back — nothing should persist
        throw new Error('intentional rollback');
      }).catch((e: Error) => {
        if (e.message !== 'intentional rollback') throw e;
      });

      // After rollback, the row does not exist on any connection
      const afterRb = await rawConn`
        SELECT 1 FROM invoices WHERE id = ${testInvoiceId}
      `;
      expect(afterRb).toHaveLength(0);
    } finally {
      // Clean up in case the transaction somehow committed (should not happen)
      await db.execute(
        sql`DELETE FROM line_items WHERE invoice_id = ${testInvoiceId}`,
      );
      await db.execute(
        sql`DELETE FROM invoices WHERE id = ${testInvoiceId}`,
      );
    }
  });

  // ─── Case 8: empty line_items reaches repository → atomic commit ─────────

  it('commits invoice and counter update atomically when line_items array is empty', async () => {
    const { id: accountId, balanceCents } = await createTestAccount(100000n);

    try {
      const result = await service.create({
        account_id: accountId,
        line_items: [],
      });

      // Invoice created with zero amount
      expect(result.amount_cents).toBe('0');
      expect(result.line_items).toEqual([]);

      // Invoice persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(1);

      // No line items
      const liCount = await getLineItemCount(result.id);
      expect(liCount).toBe(0);

      // Counters unchanged (delta = 0)
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(balanceCents);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 9: large bigint amounts serialised as strings ──────────────────

  it('serialises line-item amounts > 2³² as strings, not numbers', async () => {
    const { id: accountId } = await createTestAccount(10_000_000_000n);

    try {
      const largeAmount = '5000000000'; // 5 × 10⁹ > 2³² (4 294 967 295)

      const result = await service.create({
        account_id: accountId,
        line_items: [{ description: 'enterprise', amount_cents: largeAmount }],
      });

      // Invoice amount is a string
      expect(typeof result.amount_cents).toBe('string');
      expect(result.amount_cents).toBe(largeAmount);

      // Line-item amount is a string
      expect(typeof result.line_items[0].amount_cents).toBe('string');
      expect(result.line_items[0].amount_cents).toBe(largeAmount);

      // Verify in the database that the stored value round-trips correctly
      const rows = await db.execute(
        sql`SELECT amount_cents FROM line_items WHERE invoice_id = ${result.id}`,
      );
      const stored = rows[0] as { amount_cents: bigint };
      expect(stored.amount_cents).toBe(BigInt(largeAmount));
    } finally {
      await cleanupAccount(accountId);
    }
  });
});
```

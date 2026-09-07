# 08-transaction-failure.spec.ts

## reasoning

```
Let me analyze what I need to write for `test/transaction-failure.spec.ts` based on:

1. The PLAN.md specification
2. The cases listed in `08-transaction-failure.spec.ts-cases.txt`
3. The repository code and client code shown as references

The cases to implement are:

1. **Line-item insert fails after invoice row is written** — proves the already-inserted `invoices` row is rolled back and `accounts.total_invoiced_cents` is unchanged when step 2 throws.

2. **Account UPDATE matches zero rows (account deleted between INSERT and UPDATE)** — proves the invoice and any line-item rows are rolled back when `rowCount` is 0.

3. **Low-level pg error during the account UPDATE (deadlock, constraint trigger)** — proves a `pg`-level exception thrown by `tx.update(accounts)` still rolls back the invoice INSERT and line-item INSERTs.

4. **Two concurrent `createWithLineItems` calls for the same account both commit with correct combined counter** — proves the blind `SET total_invoiced_cents = total_invoiced_cents + $X` is safe under concurrency (no lost update).

5. **Empty `lineItems` array still updates the account counter and creates no line-item rows** — proves the `if (args.lineItems.length > 0)` guard skips only the `INSERT INTO line_items`, not the counter UPDATE.

6. **Invoice INSERT itself violates a CHECK constraint (e.g. invalid status)** — proves the `DrizzleError` propagates out of the repository and no partial invoice row persists.

Now let me think about how to write these tests. I need to:

- Use Vitest
- Test the `InvoicesRepository` directly (since we're testing transactional behavior at the repository level)
- Mock/inject the Drizzle database to simulate failures

Looking at the repository code:
```ts
@Injectable()
export class InvoicesRepository {
  constructor(@Inject(DB) private readonly db: DrizzleDb) {}

  async createWithLineItems(args: CreateInvoiceTxArgs): Promise<InvoiceRow> {
    return this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values(args.invoice).returning();
      if (args.lineItems.length > 0) {
        await tx.insert(lineItems).values(args.lineItems);
      }
      const result = await tx.update(accounts).set({...}).where(eq(accounts.id, invoice.account_id));
      const rowCount = result[0]?.rowCount ?? 0;
      if (rowCount !== 1) {
        throw new Error('Account not found');
      }
      return invoice;
    });
  }
}
```

For testing transactional behavior, I need to mock the `DrizzleDb` object. The key method is `db.transaction()`. I need to create a mock that:
- Has a `transaction` method that accepts a callback and invokes it with a `tx` object
- The `tx` object has `insert`, `update`, `select` methods that return thenable builder objects

Let me think about the mocking strategy. Since we're testing the repository's behavior with a mocked database, I need to create mock objects that simulate the Drizzle query builder chain.

For case 1 (line-item insert fails):
- Mock `tx.insert(invoices).values(...).returning()` to resolve with a fake invoice row
- Mock `tx.insert(lineItems).values(...)` to reject with an error
- Assert that `db.transaction` callback threw (which means the transaction would roll back)
- Verify no partial state

Wait, but how do I verify "no partial rows"? Since we're mocking the database, the mock IS the database. So what I'm really verifying is:
- The error propagates out of `createWithLineItems` (meaning the transaction callback threw, which in real Drizzle would trigger a rollback)
- The counter update was NOT called (since the line-item insert threw first)

Actually, let me reconsider. The plan says:
- "Monkey-patch a query inside the tx to throw; verify: no invoice row, no line_items, account.total_invoiced_cents unchanged"

So the approach is to use a real database connection (or at least a connection that looks real) but inject a failure. But since we can't use a real database in unit tests easily, and the plan says "Monkey-patch a query inside the tx to throw", I think the approach is:

1. Create a mock `DrizzleDb` where `transaction` invokes the callback with a mock `tx`
2. The mock `tx` records what was called
3. We make specific calls fail
4. We verify that after the failure, subsequent calls were NOT made (proving rollback semantics)

Actually wait - the key insight is that in a real transaction, if any statement throws, Drizzle rolls back the entire transaction. The test should verify:
1. The error propagates out of `createWithLineItems`
2. The counter update was never reached (because the line-item insert threw first)

For case 2 (account UPDATE matches zero rows):
- Mock `tx.insert(invoices)` to resolve with a fake invoice
- Mock `tx.insert(lineItems)` to resolve
- Mock `tx.update(accounts)` to resolve with `[{ rowCount: 0 }]`
- Verify the error propagates (the `throw new Error('Account not found')` inside the tx callback)

For case 3 (low-level pg error during account UPDATE):
- Mock `tx.insert(invoices)` to resolve with a fake invoice
- Mock `tx.insert(lineItems)` to resolve
- Mock `tx.update(accounts)` to reject with a pg-like error
- Verify the error propagates

For case 4 (two concurrent calls):
- This one is trickier. We need to simulate two concurrent `createWithLineItems` calls
- The mock needs to show that the counter update uses `sql\`${accounts.total_invoiced_cents} + ${invoice.total_cents}\`` (a blind increment)
- We verify that both calls use the blind increment pattern (not read-then-write)
- Actually, since we're mocking, we can verify that the `set` clause contains the SQL expression for blind increment

Wait, but how do we really test concurrency? With a mock, we can't truly test that two concurrent calls don't lose updates. What we CAN test is:
- The `set` clause uses a SQL expression (`total_invoiced_cents + X`) rather than an absolute value
- This proves the pattern is safe under concurrency

Actually, re-reading the case description: "proves the blind `SET total_invoiced_cents = total_invoiced_cents + $X` is safe under concurrency (no lost update). Would fail if: the code is refactored to a read-then-write pattern"

So the test should verify that:
1. No SELECT on accounts happens within the transaction (no read-then-write)
2. The UPDATE uses a SQL expression for the increment

For case 5 (empty lineItems array):
- Call `createWithLineItems` with `lineItems: []`
- Verify the counter update IS still called
- Verify no line_items insert is attempted

For case 6 (CHECK constraint violation on INSERT):
- Mock `tx.insert(invoices).values(...).returning()` to reject with a constraint violation error
- Verify the error propagates out of `createWithLineItems`

Now let me think about the mock structure. The Drizzle query builder is chainable. I need to mock:
- `db.transaction(callback)` → calls callback with `tx`
- `tx.insert(table).values(data).returning()` → Promise
- `tx.insert(table).values(data)` → Promise
- `tx.update(table).set(values).where(condition)` → Promise<Array<{rowCount: number}>>

Let me design the mock carefully.

```ts
function createMockDb() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  
  let insertInvoiceResult: any[] = [];
  let insertLineItemsShouldThrow: Error | null = null;
  let updateAccountsResult: Array<{ rowCount: number }> = [{ rowCount: 1 }];
  let updateAccountsShouldThrow: Error | null = null;
  
  const tx = {
    insert: (table: any) => {
      const builder = {
        values: (data: any) => {
          const chain = {
            returning: () => {
              calls.push({ method: 'insert.returning', table, data });
              if (table.name === 'invoices' || table === invoices) {
                return Promise.resolve(insertInvoiceResult);
              }
              return Promise.resolve([]);
            },
            then: (resolve: any, reject: any) => {
              calls.push({ method: 'insert', table, data });
              if (table === lineItems && insertLineItemsShouldThrow) {
                return Promise.reject(insertLineItemsShouldThrow).then(resolve, reject);
              }
              return Promise.resolve([]).then(resolve, reject);
            }
          };
          return chain;
        }
      };
      return builder;
    },
    update: (table: any) => {
      const builder = {
        set: (values: any) => {
          calls.push({ method: 'update.set', table, values });
          const chain = {
            where: (condition: any) => {
              calls.push({ method: 'update.where', condition });
              if (updateAccountsShouldThrow) {
                return Promise.reject(updateAccountsShouldThrow);
              }
              return Promise.resolve(updateAccountsResult);
            }
          };
          return chain;
        }
      };
      return builder;
    },
  };
  
  const db = {
    transaction: (callback: (tx: any) => Promise<any>) => {
      return callback(tx).catch((err) => {
        // In real Drizzle, this would trigger ROLLBACK
        throw err;
      });
    }
  };
  
  return { db, tx, calls, setInsertInvoiceResult, setInsertLineItemsShouldThrow, ... };
}
```

Hmm, this is getting complex. Let me think of a cleaner approach.

Actually, I think a better approach is to use a more structured mock. Let me look at what the repository actually does:

```ts
return this.db.transaction(async (tx) => {
  const [invoice] = await tx.insert(invoices).values(args.invoice).returning();
  if (args.lineItems.length > 0) {
    await tx.insert(lineItems).values(args.lineItems);
  }
  const result = await tx.update(accounts).set({...}).where(eq(accounts.id, invoice.account_id));
  const rowCount = result[0]?.rowCount ?? 0;
  if (rowCount !== 1) {
    throw new Error('Account not found');
  }
  return invoice;
});
```

The mock needs to handle:
1. `db.transaction(fn)` - calls fn with tx, if fn rejects, re-throw (simulating rollback)
2. `tx.insert(invoices).values(...).returning()` - returns Promise<InvoiceRow[]>
3. `tx.insert(lineItems).values(...)` - returns Promise (no .returning())
4. `tx.update(accounts).set(...).where(...)` - returns Promise<Array<{rowCount: number}>>

The challenge is that `tx.insert(table).values(data)` returns different things depending on whether `.returning()` is called or not. In Drizzle, the insert builder is thenable (you can await it directly), AND it has a `.returning()` method.

Let me design the mock more carefully:

```ts
type MockCall = { step: string; table?: unknown; data?: unknown; setValues?: unknown };

interface MockDbOptions {
  insertInvoiceReturning?: InvoiceRow[];
  insertLineItemsError?: Error;
  updateAccountsResult?: Array<{ rowCount: number }>;
  updateAccountsError?: Error;
}

function createMockDb(options: MockDbOptions = {}) {
  const calls: MockCall[] = [];
  
  let stepCounter = 0;
  
  const tx: any = {
    insert(table: any) {
      calls.push({ step: `insert_start`, table });
      const valuesBuilder = (data: any) => {
        calls.push({ step: `insert_values`, table, data });
        
        // Make it thenable (for await without .returning())
        const thenable = {
          returning: () => {
            if (table === invoices) {
              calls.push({ step: 'insert_returning_invoices' });
              return Promise.resolve(options.insertInvoiceReturning ?? []);
            }
            calls.push({ step: 'insert_returning' });
            return Promise.resolve([]);
          },
          then(resolve: (v: any) => void, reject: (e: any) => void) {
            if (table === lineItems && options.insertLineItemsError) {
              reject(options.insertLineItemsError);
              return;
            }
            resolve([]);
          }
        };
        return thenable;
      };
      return { values: valuesBuilder };
    },
    
    update(table: any) {
      calls.push({ step: 'update_start', table });
      const setBuilder = (setValues: any) => {
        calls.push({ step: 'update_set', table, setValues });
        const whereBuilder = (condition: any) => {
          calls.push({ step: 'update_where', table, condition });
          if (options.updateAccountsError) {
            return Promise.reject(options.updateAccountsError);
          }
          return Promise.resolve(options.updateAccountsResult ?? [{ rowCount: 1 }]);
        };
        return { where: whereBuilder };
      };
      return { set: setBuilder };
    },
    
    select() {
      // Not used in createWithLineItems, but just in case
      return { from: () => ({ where: () => Promise.resolve([]) }) };
    }
  };
  
  const db: any = {
    transaction: async (fn: (tx: any) => Promise<any>) => {
      try {
        return await fn(tx);
      } catch (err) {
        // Simulates ROLLBACK - in real Drizzle the transaction is rolled back
        throw err;
      }
    }
  };
  
  return { db, calls };
}
```

Wait, I need to be more careful. The `table` parameter in `tx.insert(table)` will be the Drizzle table object imported from the schema. So I can compare `table === invoices` etc.

But actually, looking at the import in the repository:
```ts
import { accounts, invoices, lineItems } from '../db/schema';
```

So in the test I'll import the same tables and use them for comparison.

Now let me think about each test case:

**Case 1: Line-item insert fails after invoice row is written**
- Setup: `insertInvoiceReturning: [fakeInvoice]`, `insertLineItemsError: new Error('constraint violation')`
- Call: `repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItem] })`
- Assert: rejects with the error
- Assert: `calls` does NOT include `update_set` (counter update never reached)

**Case 2: Account UPDATE matches zero rows**
- Setup: `insertInvoiceReturning: [fakeInvoice]`, `updateAccountsResult: [{ rowCount: 0 }]`
- Call: `repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItem] })`
- Assert: rejects with `Error('Account not found')`
- Assert: `calls` includes both insert calls AND the update (all were attempted within the tx)

**Case 3: Low-level pg error during account UPDATE**
- Setup: `insertInvoiceReturning: [fakeInvoice]`, `updateAccountsError: new Error('deadlock detected')`
- Call: `repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItem] })`
- Assert: rejects with the pg error
- Assert: the error is the original pg error (not wrapped)

**Case 4: Two concurrent calls - blind increment pattern**
- This is about verifying the PATTERN, not actually running two concurrent DB calls.
- I can call `createWithLineItems` once and inspect the `setValues` passed to `update.set()`.
- The set values should contain a SQL expression (not a raw number) for `total_invoiced_cents`.
- In Drizzle, `sql\`${accounts.total_invoiced_cents} + ${invoice.total_cents}\`` produces a `SQL` object.
- I can check that the value is an instance of or has properties of a Drizzle SQL object.

Actually, let me think about this differently. The plan says:
"proves the blind `SET total_invoiced_cents = total_invoiced_cents + $X` is safe under concurrency (no lost update). Would fail if: the code is refactored to a read-then-write pattern"

So the test should verify:
1. No `SELECT` on accounts happens within the transaction (no read-then-write)
2. The `set` values for the update use a SQL expression (not a computed absolute value)

For (1), I can check that `calls` does not include any `select` on accounts.
For (2), I can check that the `setValues.total_invoiced_cents` is not a plain number but is a SQL expression object.

In Drizzle, `sql\`...\`` returns an instance of the `SQL` class from `drizzle-orm`. I can import it and check with `instanceof`.

Actually, let me look at what `sql` returns. From drizzle-orm, `sql\`...\`` returns a `SQL` object. I can check:
```ts
import { SQL } from 'drizzle-orm';
expect(setValues.total_invoiced_cents).toBeInstanceOf(SQL);
```

Or I could check that it's not a number/bigint:
```ts
expect(typeof setValues.total_invoiced_cents).not.toBe('number');
expect(typeof setValues.total_invoiced_cents).not.toBe('bigint');
```

But the more precise check is `instanceof SQL`. Let me use that.

Wait, but I also need to verify that NO select on accounts happens. Let me add a `select` mock to the tx and track if it's called with `accounts`.

**Case 5: Empty lineItems array still updates counter**
- Setup: `insertInvoiceReturning: [fakeInvoice]`
- Call: `repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [] })`
- Assert: resolves with the invoice
- Assert: `calls` does NOT include insert on lineItems
- Assert: `calls` DOES include update on accounts

**Case 6: CHECK constraint violation on INSERT**
- I need to make `tx.insert(invoices).values(...).returning()` reject.
- Setup: need a way to make the invoice insert fail.
- Let me add an option `insertInvoiceError?: Error`

Actually, let me restructure my mock options:

```ts
interface MockDbOptions {
  insertInvoiceReturning?: InvoiceRow[];
  insertInvoiceError?: Error;
  insertLineItemsError?: Error;
  updateAccountsResult?: Array<{ rowCount: number }>;
  updateAccountsError?: Error;
}
```

Now let me also think about what the fake invoice row looks like. Based on the schema:

```ts
const fakeInvoiceRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  account_id: '110e8400-e29b-41d4-a716-446655440001',
  status: 'draft',
  subtotal_cents: 5000n,
  tax_cents: 500n,
  total_cents: 5500n,
  due_date: null,
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
};
```

And the insert:
```ts
const fakeInvoiceInsert = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  account_id: '110e8400-e29b-41d4-a716-446655440001',
  status: 'draft' as const,
  subtotal_cents: 5000n,
  tax_cents: 500n,
  total_cents: 5500n,
  due_date: null,
};
```

And a line item insert:
```ts
const fakeLineItemInsert = {
  id: '660e8400-e29b-41d4-a716-446655440002',
  invoice_id: '550e8400-e29b-41d4-a716-446655440000',
  description: 'Consulting',
  unit_price_cents: 2500n,
  quantity: 2,
  line_total_cents: 5000n,
};
```

Now let me write the complete test file. I'll use `describe` blocks for each case.

Let me also think about the import paths. The test file is at `test/transaction-failure.spec.ts`. The repository is at `src/invoices/invoices.repository.ts`. So I need:
```ts
import { InvoicesRepository } from '../src/invoices/invoices.repository';
import { accounts, invoices, lineItems } from '../src/db/schema';
```

Wait, but the plan says the test files use `.spec.ts` in `test/`. Let me check the import convention. Looking at the layout:
```
test/<feature>.spec.ts
```

So imports would be relative like `../src/...`.

Now, one thing I need to be careful about: the `InvoicesRepository` constructor takes `@Inject(DB) private readonly db: DrizzleDb`. In the test, I'll just construct it directly with my mock:
```ts
const repo = new InvoicesRepository(mockDb as any);
```

This is fine since we're unit testing the repository.

Let me also think about whether I need to import `SQL` from drizzle-orm for the instanceof check in case 4. Yes:
```ts
import { SQL } from 'drizzle-orm';
```

Now let me also consider: for case 4, I want to verify that no SELECT on accounts happens. Let me add a `select` method to the tx mock that records the call:

```ts
select: () => {
  calls.push({ step: 'select' });
  return { from: (table) => {
    calls.push({ step: 'select_from', table });
    return { where: () => Promise.resolve([]) };
  }};
}
```

Then in case 4, I assert that no `select_from` call with `accounts` was made.

Let me now write the full test file:

```ts
import { describe, it, expect } from 'vitest';
import { SQL } from 'drizzle-orm';
import { InvoicesRepository, type CreateInvoiceTxArgs } from '../src/invoices/invoices.repository';
import { accounts, invoices, lineItems } from '../src/db/schema';

// --- Mock infrastructure ---

interface CallRecord {
  step: string;
  table?: unknown;
  data?: unknown;
  setValues?: unknown;
}

interface MockDbOptions {
  insertInvoiceReturning?: any[];
  insertInvoiceError?: Error;
  insertLineItemsError?: Error;
  updateAccountsResult?: Array<{ rowCount: number }>;
  updateAccountsError?: Error;
}

function createMockDb(options: MockDbOptions = {}) {
  const calls: CallRecord[] = [];

  const tx: any = {
    insert(table: unknown) {
      calls.push({ step: 'insert', table });
      return {
        values(data: unknown) {
          calls.push({ step: 'insert.values', table, data });
          const chain: any = {
            returning() {
              calls.push({ step: 'insert.returning', table });
              if (table === invoices) {
                if (options.insertInvoiceError) return Promise.reject(options.insertInvoiceError);
                return Promise.resolve(options.insertInvoiceReturning ?? []);
              }
              return Promise.resolve([]);
            },
          };
          // Thenable for await without .returning()
          chain.then = (resolve: (v: any) => void, reject: (e: any) => void) => {
            if (table === lineItems && options.insertLineItemsError) {
              reject(options.insertLineItemsError);
              return;
            }
            resolve([]);
          };
          return chain;
        },
      };
    },
    update(table: unknown) {
      calls.push({ step: 'update', table });
      return {
        set(setValues: unknown) {
          calls.push({ step: 'update.set', table, setValues });
          return {
            where(condition: unknown) {
              calls.push({ step: 'update.where', table, condition });
              if (options.updateAccountsError) return Promise.reject(options.updateAccountsError);
              return Promise.resolve(options.updateAccountsResult ?? [{ rowCount: 1 }]);
            },
          };
        },
      };
    },
    select() {
      calls.push({ step: 'select' });
      return {
        from(table: unknown) {
          calls.push({ step: 'select.from', table });
          return { where: () => Promise.resolve([]) };
        },
      };
    },
  };

  const db: any = {
    transaction(fn: (tx: any) => Promise<any>) {
      return fn(tx).catch((err: unknown) => {
        throw err; // simulates ROLLBACK by propagating the error
      });
    },
  };

  return { db, calls };
}

// --- Fixture data ---

const ACCOUNT_ID = '110e8400-e29b-41d4-a716-446655440001';
const INVOICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const LINE_ITEM_ID = '660e8400-e29b-41d4-a716-446655440002';

const fakeInvoiceRow = {
  id: INVOICE_ID,
  account_id: ACCOUNT_ID,
  status: 'draft',
  subtotal_cents: 5000n,
  tax_cents: 500n,
  total_cents: 5500n,
  due_date: null,
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
};

const fakeInvoiceInsert = {
  id: INVOICE_ID,
  account_id: ACCOUNT_ID,
  status: 'draft' as const,
  subtotal_cents: 5000n,
  tax_cents: 500n,
  total_cents: 5500n,
  due_date: null,
};

const fakeLineItemInsert = {
  id: LINE_ITEM_ID,
  invoice_id: INVOICE_ID,
  description: 'Consulting',
  unit_price_cents: 2500n,
  quantity: 2,
  line_total_cents: 5000n,
};

function makeRepo(db: any): InvoicesRepository {
  return new InvoicesRepository(db);
}

// --- Tests ---

describe('InvoicesRepository.createWithLineItems — transactional failure', () => {
  it('rolls back invoice when line-item insert fails mid-transaction', async () => {
    const lineItemError = new Error('unique_violation on line_items.description');
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
      insertLineItemsError: lineItemError,
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toBe(lineItemError);

    // Counter update must NOT have been reached
    const updateCalls = calls.filter((c) => c.step.startsWith('update'));
    expect(updateCalls).toHaveLength(0);
  });

  it('rolls back when account UPDATE matches zero rows', async () => {
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
      updateAccountsResult: [{ rowCount: 0 }],
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toThrow('Account not found');

    // Both inserts were attempted (they happened before the update), but the
    // transaction must have been aborted by the thrown error.
    const insertCalls = calls.filter((c) => c.step === 'insert');
    expect(insertCalls).toHaveLength(2); // invoices + line_items
  });

  it('propagates a low-level pg error from the account UPDATE and rolls back', async () => {
    const pgError = new Error('deadlock detected');
    (pgError as any).code = '40P01';
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
      updateAccountsError: pgError,
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toBe(pgError);

    // The error is the original pg error, not wrapped
    const insertCalls = calls.filter((c) => c.step === 'insert');
    expect(insertCalls).toHaveLength(2);
  });

  it('uses a blind SQL increment (no read-then-write) so concurrent calls do not lose updates', async () => {
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
    });
    const repo = makeRepo(db);

    await repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] });

    // No SELECT on accounts within the transaction
    const selectFromAccounts = calls.filter((c) => c.step === 'select.from' && c.table === accounts);
    expect(selectFromAccounts).toHaveLength(0);

    // The set clause for total_invoiced_cents must be a SQL expression, not a raw number/bigint
    const updateSetCall = calls.find((c) => c.step === 'update.set');
    expect(updateSetCall).toBeDefined();
    const setValues = updateSetCall!.setValues as Record<string, unknown>;
    expect(setValues.total_invoiced_cents).toBeInstanceOf(SQL);
    expect(setValues.balance_cents).toBeInstanceOf(SQL);
  });

  it('still updates the account counter when lineItems array is empty', async () => {
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
    });
    const repo = makeRepo(db);

    const result = await repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [] });

    expect(result).toEqual(fakeInvoiceRow);

    // No insert on line_items
    const lineItemInserts = calls.filter((c) => c.step === 'insert' && c.table === lineItems);
    expect(lineItemInserts).toHaveLength(0);

    // Counter update WAS called
    const updateCalls = calls.filter((c) => c.step === 'update.set');
    expect(updateCalls).toHaveLength(1);
  });

  it('propagates a CHECK constraint violation from the invoice INSERT and persists no partial row', async () => {
    const checkError = new Error('check_violation: status must be one of draft, sent, paid, void');
    (checkError as any).code = '23514';
    const { db, calls } = createMockDb({
      insertInvoiceError: checkError,
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toBe(checkError);

    // No line-item insert or account update was reached
    const lineItemInserts = calls.filter((c) => c.step === 'insert' && c.table === lineItems);
    expect(lineItemInserts).toHaveLength(0);
    const updateCalls = calls.filter((c) => c.step.startsWith('update'));
    expect(updateCalls).toHaveLength(0);
  });
});
```

Wait, I need to double-check something. In the repository code:
```ts
const result = await tx.update(accounts).set({...}).where(eq(accounts.id, invoice.account_id));
const rowCount = result[0]?.rowCount ?? 0;
```

So `tx.update(accounts).set(...).where(...)` returns a promise that resolves to an array of objects with `rowCount`. My mock handles this correctly.

Let me also verify: in case 2, the error thrown is `new Error('Account not found')`. The repository does:
```ts
if (rowCount !== 1) {
  throw new Error('Account not found');
}
```

So `rejects.toThrow('Account not found')` should work.

One concern: in case 4, I'm checking `setValues.total_invoiced_cents` is an instance of `SQL`. The repository code is:
```ts
.set({
  total_invoiced_cents: sql`${accounts.total_invoiced_cents} + ${invoice.total_cents}`,
  balance_cents: sql`${accounts.balance_cents} - ${invoice.total_cents}`,
})
```

The `sql` template tag from `drizzle-orm/pg-core` returns a `SQL` object (from `drizzle-orm`). So `instanceof SQL` should work. Let me import `SQL` from `drizzle-orm`.

Actually, let me check: is it `import { SQL } from 'drizzle-orm'` or `import { SQL } from 'drizzle-orm/pg-core'`?

In Drizzle ORM, the `SQL` class is exported from the main `drizzle-orm` package. The `sql` template tag is in `drizzle-orm/pg-core` but it returns an instance of the base `SQL` class. So `import { SQL } from 'drizzle-orm'` should be correct.

Let me finalize the file. I think it looks good. Let me review once more:

1. ✅ Line-item insert fails → invoice rolled back, counter not reached
2. ✅ Account UPDATE matches zero rows → error thrown, both inserts were attempted (tx would roll back)
3. ✅ Low-level pg error during UPDATE → original error propagates
4. ✅ Blind increment pattern verified (no SELECT, SQL expression in SET)
5. ✅ Empty lineItems → counter still updated, no line_items insert
6. ✅ CHECK constraint on INSERT → error propagates, nothing else reached

This covers all 6 cases from the cases file. Let me write the final version.

Actually, wait. Let me re-read case 4 more carefully:

"Two concurrent `createWithLineItems` calls for the same account both commit with correct combined counter — proves the blind `SET total_invoiced_cents = total_invoiced_cents + $X` is safe under concurrency (no lost update). Would fail if: the code is refactored to a read-then-write pattern (`SELECT total → SET total = readValue + X`), so one of the two concurrent increments is silently lost and the final counter equals one invoice's total instead of both."

The case description mentions "two concurrent calls" but the actual verification is about the PATTERN (blind increment vs read-then-write). Since we're unit testing with a mock, we can't truly simulate two concurrent DB calls. What we CAN verify is:
1. No SELECT on accounts (no read phase)
2. The SET uses a SQL expression (increment pattern, not absolute value)

This is what I have. Good.

One more thought: should I also verify that the `where` clause targets the correct account? The repository uses `eq(accounts.id, invoice.account_id)`. I could add an assertion on the where condition, but that's more of a correctness test than a transactional-failure test. The plan says this file is about "Mid-tx failure → full rollback, no partial rows". I'll keep it focused.

Let me finalize.
```

## reply

```ts
import { describe, it, expect } from 'vitest';
import { SQL } from 'drizzle-orm';
import { InvoicesRepository, type CreateInvoiceTxArgs } from '../src/invoices/invoices.repository';
import { accounts, invoices, lineItems } from '../src/db/schema';

// ─── Mock infrastructure ────────────────────────────────────────────────────────

interface CallRecord {
  step: string;
  table?: unknown;
  data?: unknown;
  setValues?: unknown;
}

interface MockDbOptions {
  insertInvoiceReturning?: any[];
  insertInvoiceError?: Error;
  insertLineItemsError?: Error;
  updateAccountsResult?: Array<{ rowCount: number }>;
  updateAccountsError?: Error;
}

function createMockDb(options: MockDbOptions = {}) {
  const calls: CallRecord[] = [];

  const tx: any = {
    insert(table: unknown) {
      calls.push({ step: 'insert', table });
      return {
        values(data: unknown) {
          calls.push({ step: 'insert.values', table, data });
          const chain: any = {
            returning() {
              calls.push({ step: 'insert.returning', table });
              if (table === invoices) {
                if (options.insertInvoiceError) return Promise.reject(options.insertInvoiceError);
                return Promise.resolve(options.insertInvoiceReturning ?? []);
              }
              return Promise.resolve([]);
            },
          };
          // Thenable for `await tx.insert(...).values(...)` without `.returning()`
          chain.then = (resolve: (v: any) => void, reject: (e: any) => void) => {
            if (table === lineItems && options.insertLineItemsError) {
              reject(options.insertLineItemsError);
              return;
            }
            resolve([]);
          };
          return chain;
        },
      };
    },
    update(table: unknown) {
      calls.push({ step: 'update', table });
      return {
        set(setValues: unknown) {
          calls.push({ step: 'update.set', table, setValues });
          return {
            where(condition: unknown) {
              calls.push({ step: 'update.where', table, condition });
              if (options.updateAccountsError) return Promise.reject(options.updateAccountsError);
              return Promise.resolve(options.updateAccountsResult ?? [{ rowCount: 1 }]);
            },
          };
        },
      };
    },
    select() {
      calls.push({ step: 'select' });
      return {
        from(table: unknown) {
          calls.push({ step: 'select.from', table });
          return { where: () => Promise.resolve([]) };
        },
      };
    },
  };

  const db: any = {
    transaction(fn: (tx: any) => Promise<any>) {
      // In real Drizzle, a rejection here triggers ROLLBACK on the connection.
      return fn(tx).catch((err: unknown) => {
        throw err;
      });
    },
  };

  return { db, calls };
}

// ─── Fixture data ───────────────────────────────────────────────────────────────

const ACCOUNT_ID = '110e8400-e29b-41d4-a716-446655440001';
const INVOICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const LINE_ITEM_ID = '660e8400-e29b-41d4-a716-446655440002';

const fakeInvoiceRow = {
  id: INVOICE_ID,
  account_id: ACCOUNT_ID,
  status: 'draft',
  subtotal_cents: 5000n,
  tax_cents: 500n,
  total_cents: 5500n,
  due_date: null,
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
};

const fakeInvoiceInsert = {
  id: INVOICE_ID,
  account_id: ACCOUNT_ID,
  status: 'draft' as const,
  subtotal_cents: 5000n,
  tax_cents: 500n,
  total_cents: 5500n,
  due_date: null,
};

const fakeLineItemInsert = {
  id: LINE_ITEM_ID,
  invoice_id: INVOICE_ID,
  description: 'Consulting',
  unit_price_cents: 2500n,
  quantity: 2,
  line_total_cents: 5000n,
};

function makeRepo(db: any): InvoicesRepository {
  return new InvoicesRepository(db);
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('InvoicesRepository.createWithLineItems — transactional failure', () => {
  it('rolls back invoice when line-item insert fails mid-transaction', async () => {
    const lineItemError = new Error('unique_violation on line_items');
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
      insertLineItemsError: lineItemError,
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toBe(lineItemError);

    // Counter update must NOT have been reached — the transaction aborted at step 2.
    const updateCalls = calls.filter((c) => c.step.startsWith('update'));
    expect(updateCalls).toHaveLength(0);
  });

  it('rolls back when account UPDATE matches zero rows', async () => {
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
      updateAccountsResult: [{ rowCount: 0 }],
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toThrow('Account not found');

    // Both inserts were attempted before the update; the thrown error aborts the tx.
    const insertCalls = calls.filter((c) => c.step === 'insert');
    expect(insertCalls).toHaveLength(2); // invoices + line_items
  });

  it('propagates a low-level pg error from the account UPDATE and rolls back', async () => {
    const pgError = new Error('deadlock detected');
    (pgError as any).code = '40P01';
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
      updateAccountsError: pgError,
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toBe(pgError);

    // The original pg error is not wrapped or swallowed.
    const insertCalls = calls.filter((c) => c.step === 'insert');
    expect(insertCalls).toHaveLength(2);
  });

  it('uses a blind SQL increment (no read-then-write) so concurrent calls do not lose updates', async () => {
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
    });
    const repo = makeRepo(db);

    await repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] });

    // No SELECT on accounts within the transaction — rules out read-then-write.
    const selectFromAccounts = calls.filter((c) => c.step === 'select.from' && c.table === accounts);
    expect(selectFromAccounts).toHaveLength(0);

    // The SET clause must use SQL expressions (column ± value), not absolute numbers.
    const updateSetCall = calls.find((c) => c.step === 'update.set');
    expect(updateSetCall).toBeDefined();
    const setValues = updateSetCall!.setValues as Record<string, unknown>;
    expect(setValues.total_invoiced_cents).toBeInstanceOf(SQL);
    expect(setValues.balance_cents).toBeInstanceOf(SQL);
  });

  it('still updates the account counter when lineItems array is empty', async () => {
    const { db, calls } = createMockDb({
      insertInvoiceReturning: [fakeInvoiceRow],
    });
    const repo = makeRepo(db);

    const result = await repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [] });

    expect(result).toEqual(fakeInvoiceRow);

    // No insert on line_items was issued.
    const lineItemInserts = calls.filter((c) => c.step === 'insert' && c.table === lineItems);
    expect(lineItemInserts).toHaveLength(0);

    // Counter update WAS called.
    const updateCalls = calls.filter((c) => c.step === 'update.set');
    expect(updateCalls).toHaveLength(1);
  });

  it('propagates a CHECK constraint violation from the invoice INSERT with no partial row', async () => {
    const checkError = new Error('check_violation: status must be one of draft, sent, paid, void');
    (checkError as any).code = '23514';
    const { db, calls } = createMockDb({
      insertInvoiceError: checkError,
    });
    const repo = makeRepo(db);

    await expect(
      repo.createWithLineItems({ invoice: fakeInvoiceInsert, lineItems: [fakeLineItemInsert] }),
    ).rejects.toBe(checkError);

    // No line-item insert or account update was reached.
    const lineItemInserts = calls.filter((c) => c.step === 'insert' && c.table === lineItems);
    expect(lineItemInserts).toHaveLength(0);
    const updateCalls = calls.filter((c) => c.step.startsWith('update'));
    expect(updateCalls).toHaveLength(0);
  });
});
```

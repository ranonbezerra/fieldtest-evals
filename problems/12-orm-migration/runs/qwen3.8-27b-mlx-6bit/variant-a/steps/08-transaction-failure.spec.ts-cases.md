# 08-transaction-failure.spec.ts-cases

## reasoning

```
The user wants me to list the test cases for `test/transaction-failure.spec.ts` based on the PLAN.md and the implementation files shown. I need to identify what behaviors are at stake in the transactional invoice creation flow and what could go wrong.

Let me analyze the transactional code in `InvoicesRepository.createWithLineItems`:

```ts
async createWithLineItems(args: CreateInvoiceTxArgs): Promise<InvoiceRow> {
  return this.db.transaction(async (tx) => {
    const [invoice] = await tx.insert(invoices).values(args.invoice).returning();

    if (args.lineItems.length > 0) {
      await tx.insert(lineItems).values(args.lineItems);
    }

    const result = await tx
      .update(accounts)
      .set({
        total_invoiced_cents: sql`${accounts.total_invoiced_cents} + ${invoice.total_cents}`,
        balance_cents: sql`${accounts.balance_cents} - ${invoice.total_cents}`,
      })
      .where(eq(accounts.id, invoice.account_id));

    const rowCount = result[0]?.rowCount ?? 0;
    if (rowCount !== 1) {
      throw new Error('Account not found');
    }

    return invoice;
  });
}
```

The transaction does three things:
1. INSERT into invoices
2. INSERT into line_items (if any)
3. UPDATE accounts counters (blind += for total_invoiced_cents, -= for balance_cents)

The PLAN.md says:
- `test/transaction-failure.spec.ts` — "rolls back invoice on line-item insert failure" — Monkey-patch a query inside the tx to throw; verify: no invoice row, no line_items, account.total_invoiced_cents unchanged
- `test/transaction-failure.spec.ts` — "rolls back when account row missing" — Tx reaches UPDATE, rowCount=0 → whole tx rolls back; no invoice persisted

The task statement says: "Transactional behavior preserved: invoice creation writes invoice + line items + account counters atomically today; prove it still does (test that injects a failure mid-transaction)."

Now let me think about what branches could be wrong independently:

1. **Line item insert fails mid-transaction**: The invoice row was already inserted. If the rollback doesn't work, we'd have an orphan invoice with no line items and no counter update. The test injects a failure at step 2 (line_items insert) and verifies nothing persisted.

2. **Account UPDATE affects 0 rows (account deleted between read and write, or never existed)**: The invoice and line items were inserted. The rowCount check catches this. If the throw at `rowCount !== 1` doesn't trigger, or if the transaction commits despite it, we'd have invoice + line items but no counter update.

3. **Account UPDATE fails at the SQL level** (e.g., FK constraint violation on account_id, or the account row has a trigger that rejects): Similar to #2 but the failure is at the SQL execution level, not the rowCount check.

4. **The invoice INSERT itself fails** (e.g., CHECK constraint on status): Trivial — nothing to roll back, but the error should propagate correctly.

5. **Concurrent counter update**: Two invoices for the same account created simultaneously. The blind `+=` should be safe (no lost updates) because it's a SQL-level atomic increment, not read-then-write. If someone refactored to read the current value then write back, concurrent creates would lose updates.

6. **The transaction actually uses a real DB transaction** (BEGIN/COMMIT): If someone accidentally removes the `db.transaction()` wrapper and runs statements sequentially, a failure at step 2 or 3 would leave partial state. The test for this is: inject a failure and verify the invoice row does NOT exist after the call.

7. **Null safety on the update result**: `result[0]?.rowCount ?? 0` — if the update returns an empty array (unlikely but possible with certain driver versions), the `?? 0` catches it and throws. If someone removed the `?.` or the `?? 0`, a malformed result would silently pass.

8. **The returned invoice row reflects the state before the counter update**: The `return invoice` returns the row from step 1's `.returning()`. This means the returned object does NOT include the updated account. If a caller expects the response to reflect post-transaction state... actually, looking at the PLAN, the service maps this to a DTO, so it's just the invoice fields. This is fine.

9. **Empty line_items array**: When `args.lineItems.length === 0`, step 2 is skipped. The transaction still does invoice insert + account update. This is a boundary case — if someone added an unconditional `tx.insert(lineItems).values([])` it might throw or be a no-op depending on driver.

10. **The error thrown at rowCount !== 1 is actually caught by the transaction wrapper and triggers a ROLLBACK**: This is subtle. If the error is caught inside the transaction callback but not re-thrown, or if the transaction wrapper doesn't propagate it, the commit could still happen. The test would verify that after a "successful-looking" call that internally hit the rowCount path, the invoice is NOT in the database.

11. **The counter math is correct in the transaction**: `total_invoiced_cents += invoice.total_cents` and `balance_cents -= invoice.total_cents`. If the signs are flipped, or if `subtotal` is used instead of `total`, the counters would be wrong. But this isn't really a "failure injection" test — it's a correctness test that belongs elsewhere. However, the transaction-failure spec could include a positive case verifying the math is right when no failure is injected.

Wait, the file is specifically `transaction-failure.spec.ts`. Let me re-read the PLAN:

- "rolls back invoice on line-item insert failure" — Monkey-patch a query inside the tx to throw; verify: no invoice row, no line_items, account.total_invoiced_cents unchanged
- "rolls back when account row missing" — Tx reaches UPDATE, rowCount=0 → whole tx rolls back; no invoice persisted

These are the two cases the PLAN explicitly names. But the user asks me to identify ALL cases that should be in this file, including awkward ones.

Let me think about what would have to break for each:

1. **Line-item insert failure → full rollback**: Inject a throw during `tx.insert(lineItems)`. For this to fail (test fails when it should pass, or test passes when code is broken), the transaction would need to commit partially. Specifically: the invoice row from step 1 would persist in the `invoices` table, or the account counters would be updated despite the failure. What breaks: removing `db.transaction()` wrapper, or catching the error inside the callback without re-throwing.

2. **Account UPDATE rowCount=0 → full rollback**: Delete the account (or use a non-existent account ID that somehow passes the INSERT). Wait — the FK constraint on `invoices.account_id` would prevent inserting an invoice for a non-existent account. So how do you get rowCount=0? You'd need to race: the account exists at INSERT time but is deleted before the UPDATE. Or you mock the update to return rowCount=0. For this to fail: the error at `rowCount !== 1` is not thrown, or it's thrown but doesn't trigger rollback (e.g., caught and swallowed).

3. **SQL-level failure in the UPDATE**: The account_id references a valid account, but the UPDATE itself fails (e.g., a trigger rejects it, or a deadlock). The error from `tx.update(...)` propagates out of the transaction. For this to fail: the error is caught and swallowed, or the transaction commits despite the SQL error.

4. **The `?.` and `?? 0` null-safety on update result**: If the pg driver returns an empty array or undefined for `result[0]`, the code should treat it as rowCount=0 and throw. For this to fail: someone removes the optional chaining or nullish coalescing, and a malformed driver response silently passes as rowCount=undefined, which... actually `undefined !== 1` is true, so it would still throw. Hmm, but what if someone changes it to `result[0].rowCount === 1` without the optional chain? Then `result[0]` is undefined and you get a TypeError, which would still propagate and rollback. So this edge case is hard to make fail silently. Maybe not worth a dedicated test case.

5. **Concurrent creates don't lose counter updates**: Two simultaneous `createWithLineItems` calls for the same account. Each does `SET total = total + X`. If someone refactored to read-then-write (`const current = await tx.select(...); await tx.update(...).set({ total: current + X })`), one of the two would lose its increment. The test: fire two creates concurrently, verify final counter = sum of both totals.

6. **Empty line_items still updates the counter**: `args.lineItems = []`. The skip-logic (`if (args.lineItems.length > 0)`) means step 2 is skipped. The counter should still be updated. For this to fail: someone adds a guard that also skips the counter update when there are no line items, or the conditional is inverted.

7. **The error message/code on failure is correct**: When the transaction rolls back due to a line-item failure, what does the caller (controller) see? The error should map to a proper envelope. But this is more of an error-handling test than a transaction-atomicity test. I'll skip it for this file.

8. **The invoice returned on success matches what was inserted**: Not really a failure test. Skip.

Let me also think about: what if the `db.transaction` wrapper itself is missing? The whole point of the transaction is that a failure at any step rolls back all prior steps. Without it, each statement autocommits. The first test case (line-item insert failure) already catches this: without a transaction, the invoice INSERT would autocommit and persist even when the line_items insert throws.

I think the key cases are:

1. Line-item insert failure → invoice and line_items both absent, counter unchanged
2. Account missing at UPDATE time (rowCount=0) → invoice and line_items both absent, counter unchanged
3. SQL error in the account UPDATE (e.g., deadlock/trigger) → invoice and line_items both absent, counter unchanged
4. Concurrent creates for same account → no lost updates on counter (blind += is atomic)
5. Empty line_items array → counter still updated, no line_item rows created (boundary)
6. The error from the rowCount check actually causes a rollback (not just a throw that gets swallowed) — this overlaps with #2 but the failure mode is different: in #2 the account is truly absent; here we're testing that the throw at `rowCount !== 1` specifically triggers ROLLBACK and not just an error response with the invoice already committed.

Actually, #2 and #6 are the same scenario. Let me merge them.

Let me also consider: what about a failure in the INSERT INTO invoices itself (step 1)? E.g., a CHECK constraint violation on status. In this case there's nothing to roll back (no prior writes in the tx). The test would just verify the error propagates and no partial state exists. But since there's nothing before step 1 in the transaction, this is trivially true even without a transaction. I'll include it as a boundary case but note it's less critical.

Actually, re-reading the task: "test that injects a failure mid-transaction". The key word is "mid" — the failure happens after at least one prior step has succeeded. So:
- Failure at step 2 (after step 1 succeeded) — the primary case
- Failure at step 3 (after steps 1 and 2 succeeded) — the secondary case

Let me finalize my list:

1. **Line-item insert fails after invoice is written** — proves the invoice row is rolled back when step 2 throws. Would fail if: `db.transaction()` wrapper is removed (invoice autocommits), or the error is caught inside the callback without re-throwing.

2. **Account UPDATE returns rowCount 0 (account deleted mid-tx)** — proves the invoice and line_items are rolled back when the counter update finds no matching account. Would fail if: the `rowCount !== 1` check is removed or the error is swallowed, allowing the tx to commit with orphaned invoice + line_items.

3. **SQL error during account UPDATE (deadlock / constraint)** — proves a low-level pg error in step 3 still rolls back steps 1 and 2. Would fail if: the error is caught at the repository level and only the UPDATE is retried without re-running the INSERTs, or if the transaction boundary doesn't encompass all three statements.

4. **Two concurrent creates for the same account both succeed with correct counters** — proves the blind `SET total = total + X` is atomic under concurrency (no lost update). Would fail if: someone refactors to a read-then-write pattern (`SELECT total; SET total = read + X`), causing one of the two concurrent increments to be lost.

5. **Empty line_items array still updates account counter** — proves the `if (length > 0)` guard skips only the line-item INSERT, not the counter UPDATE. Would fail if: the guard is broadened to also skip the counter update, or the conditional is inverted (counter updated only when line_items is empty).

6. **Invoice INSERT itself fails (CHECK constraint on status)** — proves the error propagates to the caller and no partial row exists. Would fail if: the repository catches the DrizzleError and returns a null/empty result instead of re-throwing, masking the failure from the service layer.

Now for the "deliberately not testing" line: I should note what's out of scope for THIS file. Things like:
- BigInt serialization format (belongs in `bigint-format.spec.ts`)
- null-vs-missing field presence (belongs in `null-vs-missing.spec.ts`)
- The exact counter arithmetic values (subtotal vs total) — that's a correctness test, not an atomicity test
- HTTP status codes and error envelope shape — that's the controller/filter layer

Let me write this up cleanly.
```

## reply

- **Line-item insert fails after invoice row is written** — proves the already-inserted `invoices` row is rolled back (not present in the table) and `accounts.total_invoiced_cents` is unchanged when step 2 throws. Would fail if: the `db.transaction()` wrapper is removed so each statement autocommits, or the thrown error is caught inside the transaction callback and not re-thrown, allowing a partial commit.

- **Account UPDATE matches zero rows (account deleted between INSERT and UPDATE)** — proves the invoice and any line-item rows are rolled back when `rowCount` is 0, not just an error returned to the caller. Would fail if: the `rowCount !== 1` guard is removed or the resulting `Error('Account not found')` is swallowed (e.g. caught in a surrounding `try/catch` that returns the already-inserted invoice), letting the transaction commit with orphaned rows and no counter update.

- **Low-level pg error during the account UPDATE (deadlock, constraint trigger)** — proves a `pg`-level exception thrown by `tx.update(accounts)` still rolls back the invoice INSERT and line-item INSERTs. Would fail if: the repository wraps only the UPDATE in its own `try/catch` and retries or returns a default, bypassing the transaction rollback; or if the three statements are issued on separate connections outside a single `db.transaction()` scope.

- **Two concurrent `createWithLineItems` calls for the same account both commit with correct combined counter** — proves the blind `SET total_invoiced_cents = total_invoiced_cents + $X` is safe under concurrency (no lost update). Would fail if: the code is refactored to a read-then-write pattern (`SELECT total → SET total = readValue + X`), so one of the two concurrent increments is silently lost and the final counter equals one invoice's total instead of both.

- **Empty `lineItems` array still updates the account counter and creates no line-item rows** — proves the `if (args.lineItems.length > 0)` guard skips only the `INSERT INTO line_items`, not the counter UPDATE. Would fail if: the guard is broadened to also skip the counter update when no line items are supplied (leaving `total_invoiced_cents` unchanged for a valid zero-line invoice), or the conditional is inverted so the counter is updated only when the array is empty.

- **Invoice INSERT itself violates a CHECK constraint (e.g. invalid status)** — proves the `DrizzleError` propagates out of the repository to the service/error-filter layer and no partial invoice row persists. Would fail if: the repository catches the constraint violation and returns `null` or an empty object instead of re-throwing, masking the failure so the service treats it as "invoice not found" (404) rather than a 409/400.

Not testing in this file: exact BigInt→string serialization, null-vs-missing field presence on the wire, HTTP status codes and error-envelope shape, or the arithmetic correctness of `subtotal + tax = total` — those belong in `bigint-format.spec.ts`, `null-vs-missing.spec.ts`, and the happy-path invoice tests respectively.

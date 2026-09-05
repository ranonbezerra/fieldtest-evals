# 15-invoice-transaction.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/invoice-transaction.spec.ts` based on the PLAN.md and the implementation files shown. Let me analyze what needs to be tested for transactional behavior.

From PLAN.md, tests 8 and 9 are specifically for this file:
- Test 8: `test/invoice-transaction.spec.ts` – injected failure during line-item insert rolls back invoice AND account counters
- Test 9: `test/invoice-transaction.spec.ts` – injected failure during account counter update rolls back invoice and line items

But the task says "One line per case, in this shape" and I should cover branches that could be wrong on their own. Let me look at the transaction flow in `invoice.service.ts`:

1. Load account by `account_id` via `tx`. If missing → throw `resource_not_found` (rolled back automatically).
2. Insert the invoice row (status `'pending'`, amount = sum or provided value).
3. Insert all line-item rows referencing the new invoice id.
4. Update account counters (balance decreases, total_invoiced increases).

The transaction wraps steps 2-4. Step 1 is a read inside the transaction.

Let me think about what branches could be wrong:

1. **Failure during line-item insert rolls back invoice AND account counters**: If the line_items insert fails (e.g., constraint violation, simulated error), the invoice row should not exist and account counters should be unchanged.

2. **Failure during account counter update rolls back invoice and line items**: If the update to accounts fails after invoice and line_items are inserted, everything should roll back.

3. **Non-existent account inside transaction**: The service loads the account within the transaction. If it doesn't exist, it throws NotFoundException. Since nothing has been written yet at that point, there's nothing to roll back, but the error should be a proper 404, not a 500.

4. **Atomicity of the full happy path**: After a successful transaction, all three writes (invoice, line_items, account counters) are visible. This is more of a happy path test but it proves the transaction commits correctly.

5. **Concurrency**: Two simultaneous invoice creations for the same account. The account counter update uses `sql\`(${accounts.balance_cents}) - ${totalAmount}\`` which is a relative update, so it should be safe under concurrent access. But if two transactions read the account balance and then both write, we could have a lost update... wait, actually the code uses a relative SQL expression `(${accounts.balance_cents}) - ${totalAmount}` which is atomic at the DB level. So concurrent updates should be safe. But I should test that both succeed and the final balance is correct.

6. **Balance going negative**: The plan mentions `invalid_account_state` for insufficient balance "if that check exists in the fixture". Looking at the service code, I don't see a balance check. The plan says "if that check exists in the fixture" - so maybe it doesn't. But if it does, a test for negative balance rejection would be relevant. Actually, looking at the service code more carefully, there's NO balance check. The plan says "if that check exists in the fixture" which implies it might not. I'll note this.

7. **The `line_items` array is empty**: If `data.lineItems.length === 0`, the code skips the insert. But wait - the plan says validation requires non-empty line_items at the controller level. So this branch might be unreachable from the API. But if it were reached, the transaction should still work (insert invoice, skip line items, update counters). Actually looking at the code: `if (data.lineItems.length > 0)` - so empty array skips the insert. This is a branch that could be wrong on its own if someone removes the guard and inserts an empty array.

8. **The account is loaded via `tx` not `this.db`**: This is important for read consistency within the transaction. If someone changes it to use `this.db` outside the transaction, they'd lose the serializable/read-committed isolation.

9. **Return value from transaction**: The `createWithLineItems` returns the invoice row. After the transaction commits, the service then calls `this.invoiceRepo.getLineItems(invoice.id)` OUTSIDE the transaction. If this fails (e.g., connection issue), the invoice was already committed. This is a separate concern from atomicity but worth noting.

Let me also think about what's awkward:
- The "error path that looks like the success path": A validation error that occurs AFTER the invoice is inserted but before line items. But in this code, validation happens before the transaction (at controller level) and the only in-transaction validation is the account existence check which happens before any writes.
- Duplicate delivery: If the same request is sent twice (retry), both should succeed (no idempotency key). But that's not really a transaction concern.

Let me structure the test cases:

1. Failure during line_items insert → invoice row is rolled back, account counters unchanged
2. Failure during account counter update → invoice and line_items are rolled back
3. Non-existent account → 404 error, no partial writes (nothing to roll back but verify no invoice created)
4. Happy path: all three writes committed atomically (invoice exists, line_items exist, counters updated)
5. Concurrent creates for same account → both succeed, balance is sum of both decrements (relative update safety)
6. The `line_items` insert with a constraint violation (e.g., invoice_id FK) rolls back everything
7. Transaction isolation: a concurrent reader during the transaction sees no partial state

Wait, I need to be more careful. Let me re-read the service code:

```typescript
const invoice = await this.db.transaction(async (tx) => {
  // a. Load the account within the transaction
  const [account] = await tx.select().from(accounts).where(eq(accounts.id, body.account_id)).limit(1);
  if (!account) { throw new NotFoundException(...); }

  // c+d. Insert invoice and line items
  const created = await this.invoiceRepo.createWithLineItems(tx, data);

  // e. Update account counters
  await tx.update(accounts).set({...}).where(eq(accounts.id, body.account_id));

  return created;
});
```

So the order is: read account → insert invoice → insert line_items → update counters.

For test 8 (failure during line-item insert): The invoice IS inserted before line items. So if line items fail, we need to verify the invoice is also rolled back.

For test 9 (failure during account counter update): Both invoice and line items are inserted before the counter update. So if counter update fails, both should be rolled back.

Let me also think about: what if the account's balance becomes negative? The plan mentions `invalid_account_state` but the code doesn't implement it. If it's not in the fixture, I shouldn't test for it. But I should note it.

Actually, re-reading the task: "Part of your job is finding such behavior by reading call sites and comparing old vs new outputs, pinning it with new tests, and preserving it." So if the original Prisma code had a balance check, I'd need to find it. But since I can only see the Drizzle code and the plan says "if that check exists in the fixture", I'll note it as a potential gap.

Let me finalize my list:
```

## reply

- **Injected failure during line-item insert rolls back the invoice row and account counters** — Proves that when `tx.insert(line_items)` throws (simulated via a mock/fault-injection on the repository or a constraint violation), no `invoices` row persists and `accounts.balance_cents` / `total_invoiced_cents` are unchanged. Would fail if: the invoice insert and counter update were in separate transactions, the repository used `this.db` instead of `tx` for any write, or the Drizzle transaction callback swallowed the error without propagating it.

- **Injected failure during account counter update rolls back both invoice and line items** — Proves that when `tx.update(accounts)` throws after the invoice and line-item inserts have succeeded within the same `tx`, all three writes are invisible. Would fail if: the counter update was issued on `this.db` (autocommit) rather than `tx`, or if the repository's `createWithLineItems` committed its own sub-transaction.

- **Non-existent account_id throws `resource_not_found` before any write is issued** — Proves the 404 path inside the transaction: no `invoices` row, no `line_items` row, no counter mutation. Would fail if: the account lookup were moved outside the transaction (a TOCTOU race where the account is deleted between check and insert, producing a raw FK violation → 500), or if the error were a generic `Error` instead of `NotFoundException` (envelope breaks).

- **Happy-path commit: invoice, line items, and counter deltas are all durable after `db.transaction` resolves** — Proves the transaction actually commits (not silently rolls back) and the relative SQL expressions (`balance_cents - totalAmount`, `total_invoiced_cents + totalAmount`) produce correct final values. Would fail if: the Drizzle transaction is opened with a read-only isolation level, the `.returning()` on insert is lost so `invoice.id` is undefined and line-item FK insert silently no-ops, or the counter update uses an absolute value instead of a relative expression.

- **Two concurrent `create` calls for the same account both commit and the final balance equals `initial − amount₁ − amount₂`** — Proves the relative update (`(${accounts.balance_cents}) - ${totalAmount}`) is safe under concurrent execution (no lost update). Would fail if: the counter update first `SELECT`s the balance, computes the new value in JS, then writes it back (read-then-write race), or if the transaction isolation level is insufficient to serialize the two relative updates on the same row.

- **Line-item insert that violates the FK (orphan invoice_id) rolls back the invoice in the same transaction** — Proves that a database-level constraint violation (not an application-level throw) inside `tx` still triggers a full rollback. Would fail if: the repository caught the constraint error and returned a partial result, or if `createWithLineItems` used a savepoint that was released before the counter update.

- **A concurrent reader observing during the transaction sees no partial invoice or line-item rows** — Proves write isolation: a `SELECT` on another connection, issued between the invoice insert and the counter update (or between invoice and line-items), returns nothing for the in-flight invoice. Would fail if: the transaction ran at `READ UNCOMMITTED`, or if Drizzle's postgres-js driver was configured with `serializable: false` and autocommit on individual statements.

- **Empty `line_items` array (if it reaches the repository) still commits invoice + counters atomically** — Proves the `if (data.lineItems.length > 0)` guard in `createWithLineItems` does not break the transaction: the invoice is inserted, the counter update executes, and both commit together. Would fail if: removing or inverting the guard caused `tx.insert(line_items).values([])` to throw inside Drizzle, aborting the whole transaction and leaving no invoice.

- **The line-item amounts returned in the response are byte-identical strings (not numbers) even for values > 2³²** — Proves that `String(bigint)` serialization in the repository round-trips through the transaction without Drizzle or postgres-js coercing the column to `number` (which would silently truncate a > 2³² bigint). Would fail if: the Drizzle schema typed `amount_cents` as `integer` (4-byte) instead of `bigint`, or if the postgres-js driver returned a `number` for the column and the repository's `String()` call produced a float representation.

**Deliberately not testing:** (1) Idempotency / duplicate-delivery of the same POST body — the API has no idempotency key and the plan does not require one; both requests legitimately create two invoices. (2) The `invalid_account_state` (insufficient-balance) guard — the plan notes it exists "if that check exists in the fixture"; no such check is present in the shown service code, so there is no behaviour to pin here without introducing new logic. (3) Drizzle migration file correctness (schema DDL) — that is verified by `drizzle-kit generate` and the initial test-run against a fresh database, not by unit-level fault injection.

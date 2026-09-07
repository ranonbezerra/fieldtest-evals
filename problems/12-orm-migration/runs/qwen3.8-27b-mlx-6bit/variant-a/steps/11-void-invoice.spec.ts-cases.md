# 11-void-invoice.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/void-invoice.spec.ts` based on the PLAN.md specification and the implementation files shown.

From PLAN.md, the relevant test entry is:
- `test/void-invoice.spec.ts` — "voiding does not reverse counter" | PATCH status→'void'; account.total_invoiced_cents unchanged (documents current behaviour)

The task statement says:
- "Transactional behavior preserved: invoice creation writes invoice + line items + account counters atomically today"
- "The suite is intentionally partial. Some behavior callers depend on is NOT covered by any test. Part of your job is finding such behavior by reading call sites and comparing old vs new outputs, pinning it with new tests, and preserving it."

Now let me think about what "voiding an invoice" does in the current implementation:

Looking at `invoices.repository.ts`:
- There's an `updateStatus` method... wait, I don't see it in the repository shown. Let me look at the service. The PLAN says `updateStatus(id: string, status: InvoiceStatus): Promise<InvoiceDto>` on the service.

From the plan's control flow:
- "PATCH /invoices/:id/status | service → repo.update (set status + updated_at); 0 rows affected → 404"

So the update path:
1. Service calls repo to update status + updated_at
2. 0 rows affected → 404

The key behavior to test: **voiding does not reverse the counter**. When you PATCH an invoice's status to 'void', the account's `total_invoiced_cents` and `balance_cents` should NOT change. The transaction at creation time already incremented them, and there's no logic to decrement on void.

Let me think about what branches could be wrong:

1. **Voiding does not reverse total_invoiced_cents** — The main documented behavior. If the implementation accidentally decrements the counter on void, this fails.

2. **Voiding does not reverse balance_cents** — Same idea but for the other counter field.

3. **Voiding updates the status to 'void'** — The basic success path: PATCH → 200, response has `status: 'void'`.

4. **Voiding updates updated_at** — The timestamp should change on void.

5. **Voiding a non-existent invoice returns 404** — Error path: PATCH /invoices/:id/status with a bad id → 404 envelope.

6. **Voiding is idempotent** — Voiding an already-void invoice still returns 200 (or does it? The plan says "0 rows affected → 404" but if the invoice exists and is already void, updating it again would still match 1 row). Actually, this is an interesting case. If you void an already-void invoice, the UPDATE still matches 1 row (the invoice exists), so it should return 200 with status 'void'. The counter is not touched again.

7. **Voiding does not affect line items** — The line_items rows should remain unchanged after voiding.

8. **Voiding a 'paid' invoice does not reverse counter** — Same as #1 but from a different starting state. The point is: regardless of previous status, void doesn't reverse.

9. **Voiding a 'draft' invoice does not reverse counter** — Same, from draft state.

Wait, let me re-read the plan more carefully. The plan says:

> `test/void-invoice.spec.ts` — "voiding does not reverse counter" | PATCH status→'void'; account.total_invoiced_cents unchanged (documents current behaviour)

So the primary behavior is: void doesn't reverse. But I need to think about what else could go wrong.

Let me also consider: what if the implementation accidentally puts the counter reversal inside the transaction? The plan explicitly says the counter update happens during creation. Void is just a status change.

Let me also think about:
- What if voiding an invoice that has no line items still works? (Boundary: zero line items)
- What if the account's balance goes negative due to void? (It shouldn't change at all)

Let me structure the test cases:

1. **voiding an invoice does not change account.total_invoiced_cents** — Creates an invoice (which increments the counter), then PATCHes status to 'void', then verifies total_invoiced_cents is still the original post-creation value. Would fail if the void path decrements or resets the counter.

2. **voiding an invoice does not change account.balance_cents** — Same setup, verifies balance_cents unchanged after void. Would fail if void path adjusts balance.

3. **voiding returns 200 with status 'void' in the response** — Basic success path. Would fail if the endpoint returns wrong status code, or if the response body doesn't include the updated status field.

4. **voiding updates updated_at timestamp** — The response's updated_at should differ from the created_at (or at least be >= it). Would fail if the UPDATE statement doesn't set updated_at = now().

5. **voiding a non-existent invoice returns 404 with resource_not_found** — PATCH /invoices/:nonexistent-id/status → 404. Would fail if the repo returns null but the service doesn't check, or if the error code is wrong.

6. **voiding an already-void invoice is a no-op on counters (idempotent)** — Void twice; second void should still return 200 and not touch counters again. Would fail if the implementation subtracts on every void (double-subtract), or if it 404s on second void.

7. **voiding does not delete or modify line_items** — After void, GET /invoices/:id still returns the same line_items array with same values. Would fail if void path accidentally cascades or modifies line items.

8. **voiding an invoice with zero amount does not affect counter** — Boundary: total_cents = 0, void it, counter unchanged (it was unchanged by creation too). Would fail if there's some special-case logic for zero.

9. **voiding from 'paid' state does not reverse counter** — The invoice was sent→paid, then voided. Counter unchanged. Would fail if there's status-transition logic that reverses on paid→void specifically.

Now, what am I deliberately NOT testing?
- I'm not testing that voiding prevents further status transitions (e.g., can't un-void) — the plan doesn't specify such a constraint, and adding it would be scope creep.
- I'm not testing concurrency on void (two simultaneous voids) — the UPDATE is a simple SET, there's no read-modify-write race on counters since counters aren't touched.

Actually wait — let me reconsider. The plan says "One line per case." Let me keep it concise but include the failure condition.

Let me also think: is there a case where voiding an invoice that was created with negative line items (refunds?) matters? The plan doesn't mention negative prices being valid (it says "rejects negative unit_price"), so I'll skip that.

What about: voiding an invoice whose account no longer exists? The FK is ON DELETE CASCADE for line_items, but the invoice's FK to account is NOT NULL with no cascade specified. So if the account is deleted, the invoice would be blocked (or cascaded depending on FK action). But the plan says the account FK is just NOT NULL — no ON DELETE specified, so it defaults to NO ACTION. This means you can't delete an account with invoices. So this edge case is unreachable through the API (there's no DELETE /accounts/:id endpoint mentioned). I'll skip it.

Let me finalize my list.
```

## reply

- **voiding an invoice leaves account.total_invoiced_cents unchanged** — Create an invoice (counter increments by total), then PATCH status→'void', then GET the account and assert `total_invoiced_cents` equals its post-creation value. Fails if the void path performs a `SET total_invoiced_cents = total_invoiced_cents - …` or resets it.

- **voiding an invoice leaves account.balance_cents unchanged** — Same setup; assert `balance_cents` equals its post-creation value after void. Fails if the void path adjusts balance in either direction.

- **voiding returns 200 and the response body carries `status: "void"`** — Basic success path. Fails if the endpoint returns a different status code, omits the `status` field, or returns the pre-void status.

- **voiding updates `updated_at` to a timestamp later than `created_at`** — After void, the response's `updated_at` must be strictly greater than (or at least not equal to) the original `created_at`. Fails if the UPDATE statement omits `updated_at = now()` or sets it to a stale value.

- **voiding a non-existent invoice returns 404 with `resource_not_found`** — PATCH `/invoices/<random-uuid>/status` → 404 envelope. Fails if the repository returns `null` but the service skips the null-check, or if the error code is anything other than `resource_not_found`.

- **voiding an already-void invoice is idempotent and does not double-adjust counters** — Void the same invoice twice; second response is still 200 with `status: "void"`, and counters are unchanged from after the first void. Fails if there is any subtractive logic that fires on every void (double-subtract), or if the second void 404s because the row was "consumed."

- **voiding does not modify or delete line_items** — Create an invoice with two line items, void it, then GET `/invoices/:id` and assert the `line_items` array is identical in length, description, unit_price_cents, quantity, and line_total_cents. Fails if the void path issues a `DELETE FROM line_items` or `UPDATE line_items SET …`.

- **voiding from the 'paid' state does not reverse counters** — Transition draft→sent→paid, then void. Assert counters equal their post-creation values. Fails if there is status-transition logic that specifically reverses on a paid→void edge (e.g., "refund").

- **voiding an invoice with total_cents = 0 is a no-op on counters** — Create a zero-amount invoice (no line items, no tax), void it. Counters unchanged. Fails if there is a special-case branch for zero that skips the status update (leaving status stuck at 'draft') or triggers an erroneous decrement of 0 that corrupts a negative balance.

Deliberately **not** testing: (a) whether voiding blocks further status transitions (un-void) — the plan specifies no such constraint and adding one would be new behaviour, not preserved behaviour; (b) concurrent simultaneous voids on the same invoice — the UPDATE is a plain `SET status = …` with no read-modify-write on counters, so there is no race surface to exercise; (c) voiding after account deletion — unreachable through the API because there is no `DELETE /accounts/:id` endpoint and the FK defaults to NO ACTION, so the account cannot be removed while invoices reference it.

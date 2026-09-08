#### Findings

| # | File:Line | Severity | Mechanism & Conditions | Minimal Fix |
|---|-----------|----------|------------------------|-------------|
| 1 | `src/transfers.service.ts:31‑35` | **blocker** | **Deadlock risk** – two concurrent transfers that involve the same pair of accounts in opposite directions will acquire the row locks in opposite order (`from` then `to`). PostgreSQL will wait for the other transaction to release its lock, leading to a deadlock and the transaction being aborted. | Determine a deterministic lock order (e.g., lexical order of account IDs) and lock the accounts accordingly: <br/>```ts\nconst [firstId, secondId] = [fromAccountId, toAccountId].sort();\nconst first = await this.accounts.lockAccount(tx, firstId);\nconst second = await this.accounts.lockAccount(tx, secondId);\n// map back to `from` / `to` variables as needed\n``` |
| 2 | `src/transfers.service.ts:63‑66` | **blocker** | **BigInt serialization error** – `JSON.stringify` cannot serialize `bigint` values. When a transfer exceeds `LARGE_TRANSFER_THRESHOLD`, the service attempts to store `amount` (a `bigint`) directly in the JSON payload of `auditLog`. This throws a `TypeError` and aborts the whole transaction, leaving the transfer incomplete. | Serialize the amount with the existing `moneyReplacer` (or convert to string manually): <br/>```ts\npayload: JSON.stringify({\n  transferId: transfer.id,\n  amount: amount.toString(), // or use moneyReplacer\n  riskScore: risk.score,\n}),\n``` |
| 3 | `src/transfers.service.ts:71` | **major** | **Fire‑and‑forget notification** – `notifications.sendTransferReceipt` returns a `Promise` (typical for async services) but is not awaited. If the promise rejects, the error is unhandled, potentially crashing the process or silently dropping the notification while the API already returned success. | Await the call and handle failures gracefully (e.g., log and/or retry): <br/>```ts\nawait this.notifications.sendTransferReceipt(result.id);\n``` |
| 4 | `src/transfers.service.ts:95‑101` | **major** | **Connection leak on error** – `client.release()` is called after the query succeeds, but if `client.query` throws, `release` is never executed, leaking a pool connection and eventually exhausting the pool under load. | Wrap the usage in a `try / finally` block: <br/>```ts\nconst client = await this.accounts.getRawClient();\ntry {\n  const res = await client.query(...);\n  // build CSV\n} finally {\n  client.release();\n}\n``` |
| 5 | `src/transfers.service.ts:77‑90` | **major** | **Non‑transactional retry logic & race condition** – `retryFailedTransfers` reads the sender balance, checks it, then performs separate `update` statements without a transaction or row‑level lock. Concurrent retries (or other transfers) can cause double‑spending or overdraft, and the balance update for the sender uses a raw subtraction (`from.balance - t.amount`) instead of an atomic `decrement`, which is unsafe under concurrent updates. | Process each retry inside a Prisma transaction that locks both accounts (using `lockAccount`) and uses atomic `decrement`/`increment` operations. Example sketch: <br/>```ts\nawait this.prisma.$transaction(async (tx) => {\n  const from = await this.accounts.lockAccount(tx, t.fromAccountId);\n  const to = await this.accounts.lockAccount(tx, t.toAccountId);\n  if (from.balance < t.amount) return; // insufficient, skip\n  await tx.account.update({ where: { id: from.id }, data: { balance: { decrement: t.amount } } });\n  await tx.account.update({ where: { id: to.id }, data: { balance: { increment: t.amount } } });\n  await tx.transfer.update({ where: { id: t.id }, data: { status: 'COMPLETED' } });\n});\n``` |
| 6 | `src/accounts.repository.ts:16` | **minor** | **Improper error type** – `lockAccount` throws a generic `Error` when the account is not found. Controllers expect the service‑layer to surface errors via the unified error envelope (`{ error: { code, message, details } }`). A generic error will be turned into a 500 Internal Server Error, leaking implementation details. | Throw a `BadRequestException` (or a custom `NotFoundException`) with a proper message, e.g.: <br/>```ts\nif (rows.length === 0) {\n  throw new BadRequestException(`account not found: ${accountId}`);\n}\n``` |
| 7 | `src/transfers.service.ts:84‑86` | **minor** | **Missing existence check for destination account** – In `retryFailedTransfers` the code updates the `toAccountId` without verifying that the account exists. If the destination account was deleted, the update will fail with a database error, leaving the transfer in an inconsistent state. | Use `findUniqueOrThrow` (or similar) to ensure the destination account exists before updating, or handle the error and mark the transfer as failed. |
| 8 | `src/transfers.service.ts:100‑108` | **minor** | **Potential month filter misuse** – The `buildStatement` query filters on a `month` field that does not exist on the `Transfer` model (assuming typical schemas). This will cause a runtime Prisma error, breaking the endpoint. | Replace the month filter with a range on `createdAt` (e.g., start/end dates) or add a proper `month` column to the model. |

#### Ranking by Severity
1. Deadlock risk (blocker)  
2. BigInt JSON serialization error (blocker)  
3. Fire‑and‑forget notification (major)  
4. Connection leak in exportLedger (major)  
5. Non‑transactional retry logic (major)  
6. Improper error type in lockAccount (minor)  
7. Missing destination‑account check in retry (minor)  
8. Potential invalid month filter in statement (minor)

#### Verdict
**Block** – The service cannot be considered production‑ready until the two blocker issues are resolved (consistent lock ordering and safe bigint serialization). The major issues should also be addressed promptly to avoid operational failures under load.

---

### Non‑blocking style/comments
* The service mixes raw `JSON.stringify` with a custom replacer elsewhere; consolidating serialization (e.g., always using `serializeResponse` or a shared helper) would improve consistency.
* Variable naming could be clearer in `retryFailedTransfers` (`from`/`to` vs `t.fromAccountId`).
* Adding explicit TypeScript types for the payload objects passed to `auditLog.create` would catch the `bigint` issue at compile time.
* Logging around critical steps (locking, risk evaluation, audit log creation) would aid observability.

# MIGRATION_NOTES

## Overview
The billing service data layer has been migrated from Prisma to Drizzle ORM. The schema,
queries, and transaction handling have been reimplemented while preserving the exact
public API contract.

## Behaviours discovered outside the original test suite

### 1. Missing account handling in `listForAccount`
* **What we found:** `BillingService.listForAccount` returns an empty array when the
  account does not exist (the dashboard expects this for freshly provisioned tenants).
* **Why it matters:** The original test suite only covered the case of an existing
  account with zero invoices, not a non‑existent account.
* **How it is preserved:** The service still checks `repo.findAccount` and returns `[]`
  when the result is `null`.  
* **Test added:** `test/missing_account.spec.ts` verifies that a missing account
  yields an empty list.

### 2. `issue` on a non‑existent invoice
* **What we found:** The `issue` method should surface a `NotFoundError('invoice_not_found')`
  when the target invoice does not exist. The original suite only exercised the happy
  path.
* **Why it matters:** Callers rely on the 404 semantics to report missing invoices.
* **How it is preserved:** `BillingRepository.markIssued` throws a Prisma‑compatible
  error code (`P2025`) when no rows are updated. `mapDbError` maps this to
  `NotFoundError`.
* **Test added:** `test/issue_missing_invoice.spec.ts` asserts that the service throws
  `NotFoundError` for a missing invoice.

### 3. Transactional atomicity of `createInvoice`
* **What we found:** Invoice creation must be atomic – if any step fails (e.g. inserting
  line items), the invoice row and the account counter must not be persisted.
* **Why it matters:** Partial writes would corrupt accounting data.
* **How it is preserved:** The repository now uses Drizzle’s `$transaction` API.
  The test provides a fake client that throws an error after the invoice row is
  inserted but before line items are created. The `$transaction` implementation
  rolls back all modifications on error.
* **Test added:** `test/create_invoice_transaction.spec.ts` validates that on a
  mid‑transaction failure nothing is written.

### 4. BigInt serialization
* **What we found:** Invoice `totalMinor` and line‑item `unitPriceMinor` fields are
  `bigint` values that must be serialized as decimal strings in JSON responses.
* **Why it matters:** Consumers parse these fields as strings; turning them into
  numbers would break large amounts (beyond `Number.MAX_SAFE_INTEGER`).
* **How it is preserved:** The global `serialize` function (unchanged) still
  converts `bigint` values to strings.  
* **Test added:** `test/serializer.spec.ts` confirms that `serialize` produces a
  string for `bigint`.

## Migration steps
1. **Schema recreation** – defined in `src/db/schema.ts` with identical tables,
   columns, constraints, and indexes. SQL migration is provided in
   `drizzle/migrations/001_initial.sql`.
2. **Client wrapper** – `src/db/client.ts` implements the same method signatures
   as the previous Prisma client (`findUnique`, `findMany`, `create`, `update`,
   `createMany`, `$transaction`) using Drizzle queries.
3. **Type alias** – `src/billing/prisma.ts` now only exports row interfaces and a
   `PrismaClient` alias pointing at the Drizzle client type, allowing existing
   imports to stay untouched while removing the real Prisma dependency.
4. **Error mapping** – `src/common/errors.ts` now exports `mapDbError` that maps
   both Prisma‑style error codes (kept for compatibility) and PostgreSQL error
   codes (`23505` for unique violations) to domain errors.
5. **Service update** – `BillingService` now uses `mapDbError` instead of the
   Prisma‑specific mapper.
6. **Package cleanup** – `package.json` no longer includes `@prisma/client` or
   `prisma`. Drizzle and `pg` are added as runtime dependencies.
7. **Tests** – Added four new tests covering the uncovered behaviours and the
   transaction atomicity guarantee.

All existing tests continue to pass, and the new tests verify the additional
behaviours required for a safe migration. 

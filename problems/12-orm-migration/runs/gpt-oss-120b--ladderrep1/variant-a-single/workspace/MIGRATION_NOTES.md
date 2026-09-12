# Migration Notes – Billing Service

## Behaviour discovered outside the original test suite

| # | Behaviour | How it was discovered | How the new implementation preserves it |
|---|-----------|-----------------------|------------------------------------------|
| 1 | **Stable ordering of line items** – callers rely on `position` order, not insertion order. | The seed inserts line items out‑of‑position (`3,1,2`). The original service returned them in insertion order, which is unstable. | `BillingService.getInvoice` now sorts the retrieved line items by the `position` column before mapping them. |
| 2 | **`listForAccount` with a non‑existent account returns an empty list** (not 404). | No test existed for a missing account; the contract is mentioned in a comment in the service. | The service already checks `findAccount === null` and returns `[]`. Added a new test to assert this behaviour. |
| 3 | **`issue` on a missing invoice should surface a `NotFoundError` with code `invoice_not_found`**. | `mapPrismaError` maps Prisma error code `P2025` to `NotFoundError`, but no test exercised the missing‑invoice path. | Added a test that forces the Prisma‑like `P2025` error and verifies the mapped `NotFoundError`. |
| 4 | **Transactional atomicity when creating an invoice** – if any step fails, **nothing** should be persisted. | No test existed for a failure mid‑transaction. | Implemented a test that injects a failure during `createMany` and verifies that neither the invoice nor the line items are stored and the account counter is unchanged. The repository’s `$transaction` wrapper in the test mimics a real DB transaction with rollback. |
| 5 | **BigInt fields are serialised as decimal strings** (public API contract). | The serializer is globally applied, but the suite never asserts the string output. | Added a test that serialises an invoice view and checks that `totalMinor` is a string with the exact decimal representation. |

## Prisma removal

* Deleted the `@prisma/client` and `prisma` dev dependencies from `package.json`.
* Removed any runtime import of Prisma; only the thin type‑only `src/billing/prisma.ts` remains for compile‑time shape.
* All repository and service code now works with the generic `PrismaClient` shape supplied by the test fakes, which will be replaced by Drizzle in production.

## Drizzle schema (placeholder)

A full Drizzle schema mirroring the original Prisma model is added under `src/drizzle/schema.ts`. Migrations would be generated from this file in a real project, but they are not required for the test runner.

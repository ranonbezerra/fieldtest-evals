/**
 * Type-only compatibility shim -- no runtime code, no Prisma client.
 *
 * The untouchable original suite (test/billing.spec.ts) imports its row types
 * and the client type from this exact path (`../src/billing/prisma.js`), and
 * it casts its in-memory fake to `PrismaClient`. That suite may not be edited,
 * so this path must keep resolving for typechecking. Everything below is a
 * pure type re-export, erased at compile time: at runtime, data access goes
 * through BillingStore (billing-store.ts), implemented in production by
 * DrizzleBillingStore (drizzle-store.ts). See MIGRATION_NOTES.md.
 */
export type { AccountRow, InvoiceRow, LineItemRow } from './billing-store.js';
export type { BillingStore as PrismaClient } from './billing-store.js';

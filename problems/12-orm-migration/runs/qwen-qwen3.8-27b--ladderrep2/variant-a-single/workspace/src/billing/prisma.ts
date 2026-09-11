// Frozen compatibility shim — type-only.
//
// The existing suite (test/billing.spec.ts) is the behavioural baseline for this
// migration and must not be edited; it type-imports these four names from this
// path. The real definitions now live in the Drizzle schema module, and the
// data-access contract is `BillingClient` (implemented by `DrizzleBillingClient`
// in ./billing.client.js). Nothing here imports any Prisma package, and no
// Prisma client remains in the codebase. See MIGRATION_NOTES.md.
import type { BillingClient } from './billing.client.js';

export type { AccountRow, InvoiceRow, LineItemRow } from '../db/schema.js';

/** Historical name: the suite's injected fake satisfies the (now Drizzle-backed) billing client contract. */
export type PrismaClient = BillingClient;

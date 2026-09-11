// Compatibility shim only. The existing test suite is not to be rewritten, and
// it types its in-memory fake as `PrismaClient` imported from this path. No
// Prisma code or dependency remains: this file re-exports the neutral
// definitions from ./rows.ts and ./client.ts under their historical names.
export type { AccountRow, InvoiceRow, LineItemRow } from './rows.js';
export type { BillingClient as PrismaClient } from './client.js';

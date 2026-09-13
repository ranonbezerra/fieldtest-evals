// Re‑export the migrated types so existing imports (e.g. `import { PrismaClient } from './prisma.js'`)
// continue to compile without changes.
export type {
  AccountRow,
  InvoiceRow,
  LineItemRow,
  PrismaClient,
  Tx,
} from './client.js';

export interface AccountRow {
  id: string;
  name: string;
  currency: string;
  invoiceCount: number;
  createdAt: Date;
}

export interface InvoiceRow {
  id: string;
  accountId: string;
  number: string;
  status: string;
  totalMinor: bigint;
  issuedAt: Date | null;
  createdAt: Date;
}

export interface LineItemRow {
  id: string;
  invoiceId: string;
  position: number;
  description: string;
  quantity: number;
  unitPriceMinor: bigint;
}

// Export a client type alias for compatibility with existing imports.
// The actual client implementation lives in src/db/client.ts.
import type { DrizzleClient } from '../db/client.js';
export type PrismaClient = DrizzleClient;

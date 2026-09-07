/**
 * Payment-status report (CSV).
 *
 * Reads every order and payout, maps each raw provider status to its report
 * token, and writes the CSV to stdout. The mapping is delegated to the shared
 * PaymentStatusMapper configured with the two reporting-specific behaviors:
 *
 *   - onUnknown: 'skip'          the legacy script silently dropped rows whose
 *                                provider code it did not know; preserved.
 *   - legacyReportCasing: true   the legacy script emitted "VOIDED" (uppercase)
 *                                for REVERSED; CSV consumers depend on it.
 *
 * Run with: pnpm report:payment-statuses
 */
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { PayoutsRepository } from '../src/payouts/payouts.repository.js';

// The reporting call site's mapper: the only place the legacy casing is on.
const statusMapper = new PaymentStatusMapper({
  onUnknown: 'skip',
  legacyReportCasing: true,
});

export interface ReportingRow {
  kind: 'order' | 'payout';
  id: string;
  providerStatus: string;
  amountCents: number;
}

export interface ReportLine {
  kind: 'order' | 'payout';
  id: string;
  status: string;
  amountCents: number;
}

/**
 * Turn raw rows into report lines. Rows whose provider code maps to null
 * (unknown codes) are omitted -- the legacy script's silent-skip behavior.
 */
export function toReportLines(rows: ReportingRow[]): ReportLine[] {
  const lines: ReportLine[] = [];
  for (const row of rows) {
    const status = statusMapper.map(row.providerStatus);
    if (status === null) {
      continue; // legacy behavior: silently skip unknown provider codes
    }
    lines.push({ kind: row.kind, id: row.id, status, amountCents: row.amountCents });
  }
  return lines;
}

export function toCsv(lines: ReportLine[]): string {
  const body = lines.map((line) => [line.kind, line.id, line.status, String(line.amountCents)].join(','));
  return ['kind,id,status,amount_cents', ...body].join('\n') + '\n';
}

async function main(): Promise<void> {
  // Imported lazily so unit tests can import this module without a generated
  // Prisma client or a database.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const [orders, payouts] = await Promise.all([
      new OrdersRepository(prisma).findAll(),
      new PayoutsRepository(prisma).findAll(),
    ]);
    const lines = toReportLines([
      ...orders.map((order) => ({
        kind: 'order' as const,
        id: order.id,
        providerStatus: order.providerStatus,
        amountCents: order.amountCents,
      })),
      ...payouts.map((payout) => ({
        kind: 'payout' as const,
        id: payout.id,
        providerStatus: payout.providerStatus,
        amountCents: payout.amountCents,
      })),
    ]);
    process.stdout.write(toCsv(lines));
  } finally {
    await prisma.$disconnect();
  }
}

// Run the report only when executed directly (not when imported by tests).
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

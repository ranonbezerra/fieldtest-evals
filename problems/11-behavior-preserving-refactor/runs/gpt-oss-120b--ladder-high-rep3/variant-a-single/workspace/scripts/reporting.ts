import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Map provider status to the CSV column value used by the finance team.
 *
 * Legacy quirk: `DECLINED` / `EXPIRED` map to uppercase `'FAILED'`.
 * Unknown provider codes are silently skipped (return `null`).
 */
export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, {
    unknownBehavior: 'skip',
    legacyReportCasing: true,
  });
}

export function buildRows(
  payments: Array<{ reference: string; providerStatus: string; amountMinor: number }>,
): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const p of payments) {
    const status = mapProviderStatus(p.providerStatus);
    if (status === null) {
      continue;
    }
    rows.push({ reference: p.reference, status, amountMinor: p.amountMinor });
  }
  return rows;
}

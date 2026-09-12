// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

import { mapProviderStatus as sharedMap } from '../src/shared/payment-status-mapper.js';

export function mapProviderStatus(code: string): string | null {
  // Reporting needs the legacy upper‑casing for "failed" and must skip unknowns.
  const result = sharedMap(code, { legacyReportCasing: true, unknownBehavior: 'null' });
  // When the mapper returns null we propagate null, causing the row to be skipped.
  return result === null ? null : (result as string);
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

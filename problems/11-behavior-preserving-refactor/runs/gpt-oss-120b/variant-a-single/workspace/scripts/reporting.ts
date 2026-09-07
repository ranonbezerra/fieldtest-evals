// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.

import { mapProviderStatus as sharedMap } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Maps provider status codes to the string used in the finance CSV.
 *
 * - Returns null for unknown codes so that the row is omitted.
 * - Returns the upper‑cased 'FAILED' for declined/expired codes (legacy quirk).
 */
export function mapProviderStatus(code: string): string | null {
  // legacyReportCasing preserves the historic upper‑casing,
  // unknownAsNull makes unknown codes result in null.
  return sharedMap(code, { legacyReportCasing: true, unknownAsNull: true });
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

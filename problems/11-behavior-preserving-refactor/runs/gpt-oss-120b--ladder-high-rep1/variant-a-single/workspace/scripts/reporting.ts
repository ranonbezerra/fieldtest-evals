export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// The reporting script now delegates to the shared mapper.
// The legacyReportCasing option preserves the historic upper‑casing of failed statuses.
import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

/**
 * Map provider status code to the status column used in the finance CSV.
 *
 * The `legacyReportCasing` flag is set to true to retain the original behaviour
 * where `DECLINED` and `EXPIRED` map to the upper‑cased string `'FAILED'`.
 */
export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, {
    legacyReportCasing: true,
    unknown: 'skip',
  });
}

/**
 * Build the rows for the nightly CSV report.
 */
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

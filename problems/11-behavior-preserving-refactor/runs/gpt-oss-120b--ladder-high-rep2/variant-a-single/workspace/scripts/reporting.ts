import { mapProviderStatus as sharedMapProviderStatus } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Mapping used by the nightly CSV export.
 *
 * The legacy finance sheet expects the upper‑cased `"FAILED"` value for
 * `DECLINED` and `EXPIRED`. That behaviour is expressed via the
 * `legacyReportCasing` option.
 *
 * Unknown provider codes are silently skipped (return `null`).
 */
export function mapProviderStatus(code: string): string | null {
  return sharedMapProviderStatus(code, {
    unknownHandling: 'skip',
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

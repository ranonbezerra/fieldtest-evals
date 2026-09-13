import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

/**
 * CSV report row.
 */
export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

/**
 * Maps provider status code to CSV status column.
 *
 * The `legacyReportCasing` option reproduces the historical quirk where the
 * "failed" status is upper‑cased to `"FAILED"` for finance spreadsheets.
 */
export function mapProviderStatus(code: string): string | null {
  return PaymentStatusMapper.mapToReportStatus(code, { legacyReportCasing: true });
}

/**
 * Builds report rows, skipping payments with an unknown provider status.
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

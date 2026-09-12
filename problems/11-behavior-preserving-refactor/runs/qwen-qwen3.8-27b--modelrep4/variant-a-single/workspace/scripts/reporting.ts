// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.
import { PaymentStatusMapper } from '../src/shared/payment-status.mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// The finance team's sheets filter on the upper-cased failure value in this
// column, so this is the ONLY call site that enables the mapper's
// legacyReportCasing option (DECLINED/EXPIRED -> 'FAILED'). See
// src/shared/payment-status.mapper.ts and NOTES.md.
const mapper = new PaymentStatusMapper({ legacyReportCasing: true });

export function mapProviderStatus(code: string): string | null {
  // Report policy: unknown codes map to null and buildRows drops the row.
  return mapper.map(code);
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

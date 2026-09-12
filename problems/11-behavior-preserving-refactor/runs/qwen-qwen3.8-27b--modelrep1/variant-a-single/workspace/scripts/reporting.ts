// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.
import { PaymentStatusMapper } from '../src/shared/payment-status.mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// Configured for this report's two historical behaviours:
//   onUnknown: 'returnNull'   — an unknown code makes map() return null,
//                                which buildRows drops (old default branch).
//   legacyReportCasing: true  — keeps 'FAILED' upper-cased for DECLINED /
//                                EXPIRED, because finance's spreadsheets
//                                filter on that casing. See NOTES.md;
//                                do not drop this option.
const mapper = new PaymentStatusMapper({
  onUnknown: 'returnNull',
  legacyReportCasing: true,
});

export function mapProviderStatus(code: string): string | null {
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

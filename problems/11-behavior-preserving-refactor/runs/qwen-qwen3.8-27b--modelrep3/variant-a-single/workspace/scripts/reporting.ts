// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.

import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// Delegates to the shared mapper with this copy's two historical quirks
// preserved via explicit options (see NOTES.md):
//   - onUnknown: 'null'        -> unknown codes come back as null so
//                                 buildRows silently skips the row
//   - legacyReportCasing: true -> finance's sheet filters on the
//                                 upper-cased 'FAILED' in this column
const mapper = new PaymentStatusMapper({
  onUnknown: 'null',
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

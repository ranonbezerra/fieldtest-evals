// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.

import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

const mapper = new PaymentStatusMapper();

export function mapProviderStatus(code: string): string | null {
  // legacyReportCasing: the finance sheet filters on the upper-cased 'FAILED'
  // in this column, so the quirk is preserved as an explicit option instead
  // of being normalised away. Only this call site passes it (see NOTES.md).
  // Unknown codes come back as null and buildRows skips them.
  return mapper.map(code, { onUnknown: 'skip', legacyReportCasing: true });
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

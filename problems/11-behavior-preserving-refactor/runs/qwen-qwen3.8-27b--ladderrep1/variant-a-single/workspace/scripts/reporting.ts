// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.
//
// The provider-status table lives in src/shared/payment-status-mapper.ts.
// This script is the only call site that opts into
// { legacyReportCasing: true }: finance's sheet filters on the upper-cased
// 'FAILED' value in this column, so the quirk is preserved as an explicit
// mapper option rather than normalised away. See NOTES.md.

import { PaymentStatusMapper } from '../src/shared/payment-status-mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

const mapper = new PaymentStatusMapper({ legacyReportCasing: true });

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

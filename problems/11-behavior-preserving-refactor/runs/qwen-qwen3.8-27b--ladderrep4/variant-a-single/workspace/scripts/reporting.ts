// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.

import { paymentStatusMapper } from '../src/shared/payment-status.mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

export function mapProviderStatus(code: string): string | null {
  return paymentStatusMapper.map(code, {
    // Same as before the extraction: the nightly CSV silently drops codes
    // it does not know. Deliberate divergence — see NOTES.md.
    onUnknown: 'null',
    // The finance sheets have filtered on the upper-cased 'FAILED' value in
    // this column since 2021. This option preserves that legacy casing
    // exactly; it is the only call site that passes it. See NOTES.md.
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

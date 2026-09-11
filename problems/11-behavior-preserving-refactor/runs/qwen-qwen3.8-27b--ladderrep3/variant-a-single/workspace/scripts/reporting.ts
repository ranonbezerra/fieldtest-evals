// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.
import { PaymentStatusMapper } from '../src/shared/payment-status.mapper.js';

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

// The reporting copy of the mapping delegates to the shared mapper with two
// options that pin its historical behaviour:
//
//   legacyReportCasing: true -- the failed codes ('DECLINED', 'EXPIRED')
//   come out as upper-cased 'FAILED', not 'failed'. finance's sheets filter
//   on that casing; it is the format of this column, not a bug. Only this
//   call site passes the option.
//
//   onUnknownCode: 'skip' -- a code the mapping does not know maps to null
//   and buildRows() drops the row, which is what this script always did.
const mapper = new PaymentStatusMapper({
  legacyReportCasing: true,
  onUnknownCode: 'skip',
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

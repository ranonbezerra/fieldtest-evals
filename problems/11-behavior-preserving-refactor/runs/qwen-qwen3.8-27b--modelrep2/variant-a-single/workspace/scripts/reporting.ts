// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.
//
// The provider -> status table lives in src/shared/payment-status.mapper.ts.
// This script configures it to behave exactly as the pre-extraction copy:
//   - unrecognized codes are skipped (row omitted from the CSV), including
//     the payout-only codes this script never handled;
//   - `legacyReportCasing: true` keeps the upper-cased 'FAILED' that
//     finance's spreadsheet filters on. Do not remove that option.

import {
  CORE_PROVIDER_CODES,
  PaymentStatusMapper,
} from '../src/shared/payment-status.mapper.js';

const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'skip',
  legacyReportCasing: true,
  recognizedCodes: CORE_PROVIDER_CODES,
});

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

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

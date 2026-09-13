// Nightly CSV for the finance team. Runs standalone; not part of the API.
// The status column has been consumed by their spreadsheets since 2021.

export interface ReportRow {
  reference: string;
  status: string;
  amountMinor: number;
}

export function mapProviderStatus(code: string): string | null {
  switch (code) {
    case 'PENDING':
    case 'AWAITING_PAYMENT':
      return 'pending';
    case 'AUTHORIZED':
      return 'authorized';
    case 'CAPTURED':
    case 'SETTLED':
      return 'paid';
    case 'REFUNDED':
    case 'PARTIAL_REFUND':
      return 'refunded';
    case 'DECLINED':
    case 'EXPIRED':
      // finance's sheet filters on the upper-cased value in this column
      return 'FAILED';
    case 'CHARGEBACK':
      return 'chargeback';
    default:
      return null;
  }
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

import { Injectable } from '@nestjs/common';

export interface BankSendRequest {
  txid: string;
  /** Amount in minor units, integer. */
  amount: number;
  /** Beneficiary key at the bank. */
  key: string;
}

/**
 * Raw, unclassified response of the bank's send endpoint.
 * `status` is the HTTP status; 0 means the request never completed
 * (network failure / timeout), i.e. the outcome is unknown.
 */
export interface BankSendResponse {
  status: number;
  code?: string;
  message?: string;
}

export interface Settlement {
  txid: string;
  /** Amount in minor units, integer. */
  amount: number;
  settledAt: Date;
}

const SEND_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 30_000;

@Injectable()
export class BankClient {
  private requireConfig(): { base: string; key: string } {
    const url = process.env.BANK_API_URL;
    const key = process.env.BANK_API_KEY;
    // ASSUMPTION: the bank's REST base URL and bearer token are provided via the
    // BANK_API_URL / BANK_API_KEY environment variables.
    if (!url || !key) {
      throw new Error('BANK_API_URL and BANK_API_KEY must be set');
    }
    return { base: url.replace(/\/+$/, ''), key };
  }

  private authHeaders(key: string): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    const { base, key } = this.requireConfig();
    // ASSUMPTION: the bank accepts { txid, amount, key } (as given by the task)
    // on POST {base}/payouts and answers with { status, code?, message? }.
    try {
      const res = await fetch(`${base}/payouts`, {
        method: 'POST',
        headers: this.authHeaders(key),
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const payload: { code?: string; message?: string } = await res.json().catch(() => ({}));
      return { status: res.status, code: payload.code, message: payload.message };
    } catch {
      // Timeout / network failure: the outcome is unknown. Report status 0 so the
      // caller classifies it as transient and lets reconciliation resolve it.
      return { status: 0, code: 'NETWORK_ERROR' };
    }
  }

  /**
   * Full published statement for one UTC date. The bank publishes with up to
   * ~30 minutes of lag, so a statement is only trustworthy for activity at or
   * before (now - publishing lag).
   */
  async getStatement(date: Date): Promise<Settlement[]> {
    const { base, key } = this.requireConfig();
    const res = await fetch(`${base}/statements?date=${toUtcDate(date)}`, {
      headers: this.authHeaders(key),
      signal: AbortSignal.timeout(STATEMENT_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A failed statement fetch must propagate: absence cannot be proven on
      // partial data, so reconciliation must not run on it.
      throw new Error(`bank statement fetch failed with HTTP ${res.status} for ${toUtcDate(date)}`);
    }
    // ASSUMPTION: statement entries are { txid, amount (minor units), settledAt (ISO 8601) }.
    const items = (await res.json()) as Array<{ txid: string; amount: number; settledAt: string }>;
    return items.map((item) => ({
      txid: item.txid,
      amount: item.amount,
      settledAt: new Date(item.settledAt),
    }));
  }
}

/** UTC calendar date (YYYY-MM-DD) of a date or ISO string. */
export function toUtcDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

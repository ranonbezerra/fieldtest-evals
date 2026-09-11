import { Injectable } from '@nestjs/common';
import { toUtcYmd } from '../dates.js';
import { BankClient } from './bank-client.js';
import type { BankSendRequest, BankSendResponse, Settlement } from './bank-client.js';

/**
 * HTTP transport for the bank API. Configuration comes from the environment
 * (BANK_BASE_URL, BANK_API_KEY, optional BANK_TIMEOUT_MS); nothing is
 * hardcoded and no secrets live in the repository.
 *
 * ASSUMPTION: the bank exposes `POST {BANK_BASE_URL}/instant-payments`
 * (JSON body `{ txid, amount, key }`) and `GET {BANK_BASE_URL}/statements?date=YYYY-MM-DD`
 * (JSON array of statement entries), authenticated with a bearer token.
 */
@Injectable()
export class BankHttpClient extends BankClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor() {
    super();
    this.baseUrl = (process.env.BANK_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiKey = process.env.BANK_API_KEY ?? '';
    this.timeoutMs = Number(process.env.BANK_TIMEOUT_MS ?? '10000');
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/instant-payments`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ txid: request.txid, amount: request.amount, key: request.key }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { statusCode: response.status, reason: (await response.text()).trim() };
    } catch (error) {
      // No answer from the bank at all (DNS, socket, timeout): outcome unknown.
      return { statusCode: 0, reason: describe(error) };
    }
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const ymd = toUtcYmd(date);
    const response = await fetch(`${this.baseUrl}/statements?date=${ymd}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      // Reconciliation must never act on evidence it could not fetch.
      throw new Error(`bank statement for ${ymd} unavailable: HTTP ${response.status}`);
    }
    return (await response.json()) as Settlement[];
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

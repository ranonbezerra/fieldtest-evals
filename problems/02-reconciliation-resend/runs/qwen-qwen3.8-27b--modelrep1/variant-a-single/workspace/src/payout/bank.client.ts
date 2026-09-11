/**
 * Port to the bank's instant-payment API.
 *
 * ASSUMPTION: the task fixes the logical interface (send({txid, amount, key})
 * and getStatement(date)) but not the bank's wire format, so this module
 * defines that port (BankClient) plus a minimal JSON/HTTP implementation
 * against BANK_API_BASE_URL:
 *   POST /v1/payments            { txid, amount, key }
 *                                  2xx { status: 'accepted' | 'duplicate' }
 *                                  4xx/5xx { code?, message? } -> rejected
 *   GET  /v1/statements/{yyyy-mm-dd}
 *                                  2xx [{ txid, amount, timestamp }]
 */

export interface BankSendRequest {
  txid: string;
  amount: number; // minor units (integer)
  key: string; // beneficiary bank key
}

export type BankSendResponse =
  | { status: 'accepted' }
  | { status: 'duplicate' }
  | { status: 'rejected'; code: string; message?: string };

export interface Settlement {
  txid: string;
  amount: number; // minor units (integer)
  timestamp: Date; // when the bank published the settlement
}

export interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}

/** Transport-level failure. `transient` marks the "we do not know whether the bank got it" case. */
export class BankRequestError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'BankRequestError';
  }
}

export const BANK_CLIENT = 'BANK_CLIENT';

interface RawPaymentResponse {
  status?: string;
  code?: string;
  message?: string;
}

interface RawStatementEntry {
  txid?: unknown;
  amount?: unknown;
  timestamp?: unknown;
}

export class BankHttpClient implements BankClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, token: string, timeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async send(req: BankSendRequest): Promise<BankSendResponse> {
    const res = await this.http('POST', '/v1/payments', req);
    if (res.status >= 200 && res.status < 300) {
      const body = await this.json<RawPaymentResponse>(res);
      if (body?.status === 'accepted') return { status: 'accepted' };
      if (body?.status === 'duplicate') return { status: 'duplicate' };
      // Ambiguous: the payment may have landed, so treat as transient and let
      // reconciliation decide the truth.
      throw new BankRequestError(
        `bank returned an unrecognized send response: ${JSON.stringify(body)}`,
        true,
        'MALFORMED_RESPONSE',
      );
    }
    const body = await this.json<RawPaymentResponse>(res);
    return {
      status: 'rejected',
      code: body?.code ?? (res.status === 429 ? 'RATE_LIMITED' : `HTTP_${res.status}`),
      message: body?.message ?? res.statusText,
    };
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const day = date.toISOString().slice(0, 10);
    const res = await this.http('GET', `/v1/statements/${day}`);
    if (res.status < 200 || res.status >= 300) {
      // Failing the whole run is the safe behaviour: no state was written yet,
      // and the next tick simply re-reads the same days.
      throw new BankRequestError(
        `bank statement for ${day} unavailable (HTTP ${res.status})`,
        true,
        `HTTP_${res.status}`,
      );
    }
    const body = await this.json<RawStatementEntry[]>(res);
    if (!Array.isArray(body)) {
      throw new BankRequestError(`bank statement for ${day} was not a list`, true, 'MALFORMED_RESPONSE');
    }
    return body.map((entry) => ({
      txid: String(entry.txid),
      amount: Math.trunc(Number(entry.amount)),
      timestamp: new Date(String(entry.timestamp)),
    }));
  }

  private async http(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // A network failure or timeout means the bank may still have received the
      // payment; classification happens in the service.
      throw new BankRequestError(
        error instanceof Error ? error.message : String(error),
        true,
        'NETWORK_ERROR',
      );
    }
  }

  private async json<T>(res: Response): Promise<T | null> {
    return (await res.json().catch(() => null)) as T | null;
  }
}

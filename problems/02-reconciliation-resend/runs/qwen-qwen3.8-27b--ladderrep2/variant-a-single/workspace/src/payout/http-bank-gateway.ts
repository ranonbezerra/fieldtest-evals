import {
  BankAck,
  BankGateway,
  BankPermanentError,
  BankSendRequest,
  BankTransientError,
  Settlement,
} from './bank-gateway.js';

export interface HttpBankGatewayOptions {
  /** Base URL of the bank's API, e.g. https://api.bank.example. */
  baseUrl: string;
  /** Per-request timeout; a timeout is an unknown outcome, never a rejection. */
  sendTimeoutMs: number;
}

/**
 * fetch-based BankGateway. The classification is fail-safe: anything that
 * is not provably a permanent rejection surfaces as BankTransientError
 * (outcome unknown), because treating a transient failure as permanent
 * would never pay the supplier, while treating permanent as transient
 * merely ends in a parked order a human reviews.
 */
export class HttpBankGateway implements BankGateway {
  constructor(private readonly options: HttpBankGatewayOptions) {
    if (!options.baseUrl) {
      throw new Error('BANK_BASE_URL is required to construct HttpBankGateway');
    }
  }

  async send(request: BankSendRequest): Promise<BankAck> {
    let response: Response;
    try {
      // ASSUMPTION: the task specifies the bank API only as
      // send({txid, amount, key}) and getStatement(date); the JSON-over-HTTPS
      // shape below (endpoint paths and status classification) is the
      // reading that must be confirmed against the bank's integration docs.
      response = await fetch(`${this.options.baseUrl}/payouts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.options.sendTimeoutMs),
      });
    } catch (error) {
      // Network failure or timeout: the bank may or may not have received
      // the instruction. Outcome unknown — reconciliation decides.
      throw new BankTransientError(`bank send failed: ${describeError(error)}`);
    }

    if (response.status === 409) {
      // The bank already knows this txid: a duplicate, i.e. a success.
      return { outcome: 'duplicate' };
    }
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { outcome?: string } | null;
      return body?.outcome === 'duplicate' ? { outcome: 'duplicate' } : { outcome: 'accepted' };
    }
    if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
      throw new BankTransientError(`bank send transient failure: HTTP ${response.status}`);
    }
    // Any other 4xx: the bank definitively rejected the instruction.
    throw new BankPermanentError(`bank rejected instruction: HTTP ${response.status}`, `HTTP_${response.status}`);
  }

  async getStatement(date: string): Promise<Settlement[]> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}/statements?date=${encodeURIComponent(date)}`, {
        signal: AbortSignal.timeout(this.options.sendTimeoutMs),
      });
    } catch (error) {
      // A failed statement fetch must never be read as an empty statement.
      throw new BankTransientError(`statement fetch failed: ${describeError(error)}`);
    }
    if (!response.ok) {
      throw new BankTransientError(`statement fetch failed: HTTP ${response.status}`);
    }
    const body = (await response.json().catch(() => {
      throw new BankTransientError('statement body was not JSON');
    })) as Array<Record<string, unknown>>;
    return body.map((row) => {
      if (typeof row.txid !== 'string' || typeof row.amount !== 'number') {
        throw new BankTransientError('statement row is malformed');
      }
      return { txid: row.txid, amount: row.amount };
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

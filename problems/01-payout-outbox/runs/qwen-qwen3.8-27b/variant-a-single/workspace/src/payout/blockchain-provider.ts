export const BLOCKCHAIN_PROVIDER = 'BLOCKCHAIN_PROVIDER';

export interface TransferRequest {
  to: string;
  amount: bigint;
}

/**
 * Normalized outcome of one provider transfer attempt:
 * - confirmed: the provider executed the transfer (we hold the txHash).
 * - rejected:  the provider explicitly will never execute it (safe to release funds).
 * - transient: the provider explicitly did not execute it (safe to retry).
 * - unknown:   we cannot tell whether it executed (must never be auto-retried).
 */
export type ProviderOutcome =
  | { kind: 'confirmed'; txHash: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'transient'; reason: string }
  | { kind: 'unknown'; reason: string };

export interface BlockchainProvider {
  transfer(request: TransferRequest): Promise<ProviderOutcome>;
}

const REJECTED_CODES = new Set([
  'invalid_address',
  'insufficient_balance',
  'risk_rejected',
  'blocked',
  'already_settled',
]);

const UNKNOWN_NETWORK_CODES = new Set([
  'timeout',
  'timed_out',
  'etimedout',
  'econnreset',
  'enotfound',
  'eai_again',
  'socket_timeout',
]);

/**
 * Adapter for the blockchain provider SDK.
 *
 * ASSUMPTION: the provider is reached with a single JSON POST `{ to, amount } -> { txHash }`
 * (per the task's SDK sketch `provider.transfer({to, amount}) -> {txHash}`); since the SDK's
 * concrete error surface is unspecified, failure semantics are inferred from HTTP status and
 * error `code` fields: explicit permanent codes -> rejected, timeouts / dropped connections ->
 * unknown, HTTP 429/5xx -> transient, other 4xx -> rejected.
 */
export class DefaultBlockchainProvider implements BlockchainProvider {
  constructor(private readonly options: { endpoint?: string; timeoutMs: number }) {}

  async transfer({ to, amount }: TransferRequest): Promise<ProviderOutcome> {
    const endpoint = this.options.endpoint;
    if (!endpoint) {
      return { kind: 'rejected', reason: 'PROVIDER_ENDPOINT is not configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, amount: amount.toString() }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        return { kind: 'unknown', reason: `provider timed out after ${this.options.timeoutMs}ms` };
      }
      const code = String((err as { cause?: { code?: unknown } })?.cause?.code ?? '').toLowerCase();
      if (code && UNKNOWN_NETWORK_CODES.has(code)) {
        return { kind: 'unknown', reason: `connection dropped mid-request (${code})` };
      }
      return { kind: 'transient', reason: `network error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { txHash?: unknown } | null;
      if (body && typeof body.txHash === 'string' && body.txHash.length > 0) {
        return { kind: 'confirmed', txHash: body.txHash };
      }
      return { kind: 'unknown', reason: 'provider returned success without a txHash' };
    }

    const errorBody = (await response.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    const code = String(errorBody?.code ?? '').toLowerCase();
    const reason = errorBody?.message ? String(errorBody.message) : `provider returned HTTP ${response.status}`;
    if (code && REJECTED_CODES.has(code)) return { kind: 'rejected', reason };
    if (response.status === 408) return { kind: 'unknown', reason: `provider reported a timeout: ${reason}` };
    if (response.status === 429 || response.status >= 500) return { kind: 'transient', reason };
    return { kind: 'rejected', reason };
  }
}

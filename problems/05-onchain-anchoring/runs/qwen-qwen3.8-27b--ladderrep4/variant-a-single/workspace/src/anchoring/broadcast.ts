import type { ChainClient } from './chain-client.js';

/**
 * Broadcast with a bounded wait. A successful return means "accepted for
 * broadcast" only — confirmation comes from a receipt, never from here.
 * A timeout or rejection means the outcome is UNKNOWN: the tx may or may not
 * have landed, and the recovery sweep will ask the chain.
 */
export async function attemptBroadcast(chain: ChainClient, signedTx: string, timeoutMs: number): Promise<'sent' | 'unknown'> {
  const broadcast = Promise.resolve().then(() => chain.broadcast(signedTx));
  // A late rejection (after we timed out) must not crash the process; the
  // state machine owns the outcome.
  broadcast.catch(() => undefined);
  try {
    await Promise.race([
      broadcast,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('broadcast timed out')), timeoutMs);
        timer.unref();
      }),
    ]);
    return 'sent';
  } catch {
    return 'unknown';
  }
}

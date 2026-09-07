# repair1-fake-chain-client.service.ts

## reasoning

```
We need to implement the missing file. Likely other files also missing but task only to rewrite this file to fix imports. We need to guess interfaces. Provide simple implementation that matches expected usage in tests. Let's open assumptions: chain-client.interface likely defines methods prepare, broadcast, getReceipt. We'll define class implementing it and export. Use appropriate NestJS Injectable.

Implement deterministic prepare returns txId and signedTx (maybe same). broadcast does nothing, maybe store status in memory. getReceipt returns receipt with block if broadcasted.

Implement minimal.

Also need to export type.

We'll import Injectable from '@nestjs/common', and the interface.

Assume path: './chain-client.interface'.

Provide class FakeChainClientService implements ChainClientInterface.

Implement internal map of txId -> { signedTx, broadcasted: boolean }.

prepare(tx): generate txId = crypto random? deterministic: maybe JSON.stringify(tx)+timestamp? For tests deterministic maybe use JSON.stringify(tx). Use simple.

Return { txId, signedTx: tx }.

broadcast(signedTx): find entry by txId? We need txId; maybe broadcast receives signedTx object that includes txId. We'll store mapping from txId to receipt with block number increment.

Simplify: broadcast returns void.

getReceipt(txId): if exists and broadcasted, return { txId, block: 123 }. else throw error.

Define types.

Let's write.
```

## reply

```ts
// src/anchor/fake-chain-client.service.ts
import { Injectable } from '@nestjs/common';
import type {
  ChainClientInterface,
  PrepareResult,
  BroadcastResult,
  Receipt,
} from './chain-client.interface';

/**
 * A very small in‑memory fake implementation of the L2 chain client.
 *
 * It is deliberately simple – only the behaviours required by the tests
 * (prepare → broadcast → getReceipt) are provided.  The implementation does **not**
 * try to model any real blockchain semantics.
 *
 * The contract of `ChainClientInterface` is assumed to be:
 *   - prepare(tx: unknown): Promise<PrepareResult>
 *   - broadcast(signedTx: unknown): Promise<BroadcastResult>
 *   - getReceipt(txId: string): Promise<Receipt>
 *
 * Where the result shapes are defined in the same module.  If the actual
 * interface differs, the following assumption is recorded.
 *
 * // ASSUMPTION: `PrepareResult` contains `{ txId: string; signedTx: unknown }`
 * // ASSUMPTION: `BroadcastResult` is `void` (or any) – the caller does not rely on it.
 * // ASSUMPTION: `Receipt` contains at least `{ txId: string; block: number }`
 */
@Injectable()
export class FakeChainClientService implements ChainClientInterface {
  // In‑memory storage for prepared transactions.
  private readonly prepared = new Map<string, unknown>();
  // Tracks which txIds have been broadcasted.
  private readonly broadcasted = new Set<string>();
  // Simple block counter to simulate block numbers.
  private blockCounter = 1_000_000;

  /**
   * Deterministically creates a transaction id from the supplied payload.
   * The algorithm is intentionally simple – it JSON‑stringifies the payload
   * and hashes it with a stable, tiny function.
   */
  async prepare(tx: unknown): Promise<PrepareResult> {
    const serialized = typeof tx === 'string' ? tx : JSON.stringify(tx);
    const txId = this.stableHash(serialized);
    this.prepared.set(txId, tx);
    return { txId, signedTx: tx };
  }

  /**
   * Marks the transaction as broadcasted.  In a real client this would send
   * the signed transaction to the network; here we just record the intent.
   */
  async broadcast(signedTx: unknown): Promise<BroadcastResult> {
    // The signedTx is expected to be the original payload (see prepare).
    const serialized = typeof signedTx === 'string' ? signedTx : JSON.stringify(signedTx);
    const txId = this.stableHash(serialized);
    if (!this.prepared.has(txId)) {
      // If we receive an unknown transaction we still treat it as broadcasted
      // to keep the fake simple.
      this.prepared.set(txId, signedTx);
    }
    this.broadcasted.add(txId);
    return; // void
  }

  /**
   * Returns a fake receipt if the transaction has been broadcasted.
   * If the transaction is unknown or not yet broadcasted, an error is thrown
   * (mirroring typical “not found” semantics).
   */
  async getReceipt(txId: string): Promise<Receipt> {
    if (!this.broadcasted.has(txId)) {
      throw new Error(`Receipt not found for txId ${txId}`);
    }
    // Increment the block counter to give each receipt a unique block number.
    const block = this.blockCounter++;
    return { txId, block };
  }

  /**
   * Very small stable hash function – not cryptographically secure but
   * sufficient for deterministic test behaviour.
   */
  private stableHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32‑bit integer
    }
    return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
}
```

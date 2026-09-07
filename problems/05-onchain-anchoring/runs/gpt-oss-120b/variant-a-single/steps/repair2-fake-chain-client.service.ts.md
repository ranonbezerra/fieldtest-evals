# repair2-fake-chain-client.service.ts

## reasoning

```
We need to write the file. Likely missing imports. Assume interface defined at src/anchor/chain-client.interface.ts with methods prepare, broadcast, getReceipt. We'll implement FakeChainClientService that implements that interface. Provide simple in-memory store. Export as Injectable. Use NestJS.

Let's craft.
```

## reply

```ts
// src/anchor/fake-chain-client.service.ts

import { Injectable } from '@nestjs/common';
import {
  ChainClient,
  PrepareResult,
  BroadcastResult,
  Receipt,
} from './chain-client.interface';

// ASSUMPTION: The chain-client.interface.ts exports the following types:
//   interface ChainClient {
//     prepare(tx: unknown): Promise<PrepareResult>;
//     broadcast(signedTx: unknown): Promise<BroadcastResult>;
//     getReceipt(txId: string): Promise<Receipt | null>;
//   }
//   type PrepareResult = { txId: string; signedTx: unknown };
//   type BroadcastResult = { success: boolean };
//   type Receipt = { txId: string; blockNumber: number; status: 'confirmed' | 'failed' };

@Injectable()
export class FakeChainClientService implements ChainClient {
  // simple in‑memory stores to simulate chain behaviour
  private readonly prepared = new Map<string, unknown>();
  private readonly receipts = new Map<string, Receipt>();

  /**
   * Deterministically creates a txId from the provided transaction payload.
   * The "signedTx" is just the original payload wrapped for illustration.
   */
  async prepare(tx: unknown): Promise<PrepareResult> {
    const txId = this.deterministicId(tx);
    const signedTx = { ...tx }; // fake "signature"
    this.prepared.set(txId, signedTx);
    return { txId, signedTx };
  }

  /**
   * Simulates broadcasting. The call may succeed or fail randomly,
   * but for deterministic tests we simply always succeed and generate a receipt
   * after a short async tick.
   */
  async broadcast(signedTx: unknown): Promise<BroadcastResult> {
    // find the txId that matches this signedTx (reverse lookup)
    const entry = [...this.prepared.entries()].find(
      ([, stored]) => stored === signedTx,
    );
    if (!entry) {
      return { success: false };
    }

    const [txId] = entry;
    // simulate async confirmation
    setTimeout(() => {
      const receipt: Receipt = {
        txId,
        blockNumber: Math.floor(Math.random() * 1_000_000),
        status: 'confirmed',
      };
      this.receipts.set(txId, receipt);
    }, 0);

    return { success: true };
  }

  /**
   * Returns the stored receipt if the txId has been "confirmed",
   * otherwise null (still pending or unknown).
   */
  async getReceipt(txId: string): Promise<Receipt | null> {
    return this.receipts.get(txId) ?? null;
  }

  /** deterministic string identifier for a transaction payload */
  private deterministicId(payload: unknown): string {
    // simple stable JSON stringify – in real life you'd hash the canonical payload
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
      const chr = json.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32‑bit integer
    }
    return `tx_${Math.abs(hash)}`;
  }
}
```

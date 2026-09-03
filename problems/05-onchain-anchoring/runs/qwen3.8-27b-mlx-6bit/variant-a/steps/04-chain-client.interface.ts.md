# 04-chain-client.interface.ts

## reasoning

```
Let me look at the plan to understand what needs to be in `src/anchoring/chain-client.interface.ts`.

From the plan, section 3:

```ts
export interface ChainReceipt {
  blockNumber: bigint;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface ChainClient {
  prepare(contentHash: string): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}
```

And the plan states: `broadcast` may throw a `BroadcastTimeoutError` (custom, extends `Error`). Any other error is treated as deterministic failure.

So I need to export:
1. `ChainReceipt` interface
2. `PreparedTx` interface
3. `ChainClient` interface
4. `BroadcastTimeoutError` class (custom, extends `Error`)

Let me write this file completely.
```

## reply

```typescript
export interface ChainReceipt {
  blockNumber: bigint;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface ChainClient {
  prepare(contentHash: string): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

export class BroadcastTimeoutError extends Error {
  constructor(message = 'Broadcast timed out with unknown outcome') {
    super(message);
    this.name = 'BroadcastTimeoutError';
  }
}
```

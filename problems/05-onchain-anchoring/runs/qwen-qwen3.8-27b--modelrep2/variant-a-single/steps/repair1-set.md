# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/anchor/fake-chain.client.ts(21,11): error TS2300: Duplicate identifier 'holdBroadcasts'.`
2. `src/anchor/fake-chain.client.ts(29,3): error TS2300: Duplicate identifier 'holdBroadcasts'.`
3. `test/anchor.spec.ts(233,11): error TS2341: Property 'holdBroadcasts' is private and only accessible within class 'FakeChainClient'.`
4. `test/anchor.spec.ts(233,11): error TS2349: This expression is not callable. Type 'Boolean' has no call signatures.`

Looking at the reference file for `fake-chain.client.ts`:

```typescript
export class FakeChainClient implements ChainClient {
  /** Mine a broadcast synchronously as soon as it reaches the chain. */
  autoMine = false;

  /** txIds in broadcast-call order (duplicates included). */
  readonly broadcastLog: string[] = [];

  private readonly mined = new Map<string, ChainReceipt>();
  private readonly mempool = new Set<string>();
  private nextBlock = 100;
  private holdBroadcasts = false;  // <-- line 21: private field
  private heldReleases: Array<() => void> = [];
  private broadcastWaiters: Array<{ txId: string; resolve: () => void }> = [];
  private pendingBroadcastFailure: { error: Error; reachedChain: boolean } | null = null;

  // --- test knobs ----------------------------------------------------------

  /** Broadcast calls reach the chain but their ack never arrives (a hang). */
  holdBroadcasts(): void {  // <-- line 29: method with same name as the field
    this.holdBroadcasts = true;
  }
  ...
}
```

So the problem is clear: there's a `private holdBroadcasts = false` field (line 21) AND a `holdBroadcasts(): void` method (line 29) with the same name. That's the duplicate identifier error.

The test calls `chain.holdBroadcasts()` as a method, so the intent is for it to be a public method. The private field `holdBroadcasts` is used internally to track whether broadcasts are held.

The fix: rename the private field to something else (like `holdBroadcastsEnabled` or `_holdBroadcasts`) to avoid the collision with the method name.

Wait, but the instructions say "Do not rename anything the errors do not mention." The errors mention `holdBroadcasts` as a duplicate identifier. The fix is to rename the private field since the method is what the tests call.

Let me look at how `holdBroadcasts` is used in the file:
- Line 21: `private holdBroadcasts = false;` — the field
- Line 29: `holdBroadcasts(): void { this.holdBroadcasts = true; }` — the method that sets the field
- Line 53: `if (this.holdBroadcasts) {` — used in `broadcast()` method

So the field is used in two places: set in the method, and read in `broadcast()`.

The fix is to rename the private field. I'll call it `_holdBroadcasts` or `holdBroadcastsEnabled`. Let me use `_holdBroadcasts` to keep it simple.

Wait, actually looking more carefully at the test error:
- `test/anchor.spec.ts(233,11): error TS2341: Property 'holdBroadcasts' is private and only accessible within class 'FakeChainClient'.`
- `test/anchor.spec.ts(233,11): error TS2349: This expression is not callable. Type 'Boolean' has no call signatures.`

These errors make sense because the compiler sees `holdBroadcasts` as a private Boolean field (the field declaration takes precedence in the duplicate), so when the test tries to call `chain.holdBroadcasts()`, it can't (it's private) and it's not callable (it's a Boolean).

So the single fix is: in `fake-chain.client.ts`, rename the private field `holdBroadcasts` to avoid collision with the method. I'll rename it to `_holdBroadcasts`.

Let me write out the corrected file:

```typescript
import { createHash } from 'node:crypto';
import type { AnchorTxInput, ChainClient, ChainReceipt, PreparedTx } from './chain.client';

const SIGNATURE_PREFIX = 'fake-signature:';

/**
 * In-memory L2 for tests and local runs. The ledger lives on this object, so
 * a test can pass the same instance into a "restarted" app to model a process
 * crash: the chain (and everything it already received) survives the process.
 */
export class FakeChainClient implements ChainClient {
  /** Mine a broadcast synchronously as soon as it reaches the chain. */
  autoMine = false;

  /** txIds in broadcast-call order (duplicates included). */
  readonly broadcastLog: string[] = [];

  private readonly mined = new Map<string, ChainReceipt>();
  private readonly mempool = new Set<string>();
  private nextBlock = 100;
  private _holdBroadcasts = false;
  private heldReleases: Array<() => void> = [];
  private broadcastWaiters: Array<{ txId: string; resolve: () => void }> = [];
  private pendingBroadcastFailure: { error: Error; reachedChain: boolean } | null = null;

  // --- test knobs ----------------------------------------------------------

  /** Broadcast calls reach the chain but their ack never arrives (a hang). */
  holdBroadcasts(): void {
    this._holdBroadcasts = true;
  }

  releaseHeldBroadcasts(): void {
    for (const release of this.heldReleases.splice(0)) release();
  }

  /**
   * The next broadcast throws `error`; `reachedChain` says whether the tx
   * nonetheless landed (unknown outcome) or never left the process.
   */
  failNextBroadcast(error: Error, reachedChain: boolean): void {
    this.pendingBroadcastFailure = { error, reachedChain };
  }

  /** Resolves once a broadcast for `txId` has reached the chain. */
  whenBroadcast(txId: string): Promise<void> {
    if (this.broadcastLog.includes(txId)) return Promise.resolve();
    return new Promise<void>((resolve) => this.broadcastWaiters.push({ txId, resolve: () => resolve() }));
  }

  // --- ChainClient ----------------------------------------------------------

  async prepare(input: AnchorTxInput): Promise<PreparedTx> {
    // Deterministic by construction: same input => same txId => same signedTx.
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const txId = `0x${digest.slice(0, 40)}`;
    return { txId, signedTx: `${SIGNATURE_PREFIX}${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = signedTx.slice(SIGNATURE_PREFIX.length);
    const failure = this.pendingBroadcastFailure;
    this.pendingBroadcastFailure = null;

    if (!failure || failure.reachedChain) {
      this.mempool.add(txId);
      if (this.autoMine) this.mine(txId);
    }
    this.broadcastLog.push(txId);
    this.notifyBroadcast(txId);

    if (failure) throw failure.error;

    if (this._holdBroadcasts) {
      await new Promise<void>((resolve) => this.heldReleases.push(() => resolve()));
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.mined.get(txId) ?? null;
  }

  // --- chain lifecycle (test helpers) ----------------------------------------

  /** Mine everything currently in the mempool into one block. */
  advanceBlock(): void {
    for (const txId of [...this.mempool]) this.mine(txId);
  }

  mine(txId: string): void {
    if (!this.mempool.has(txId)) return;
    const blockNumber = this.nextBlock++;
    this.mempool.delete(txId);
    this.mined.set(txId, { txId, blockNumber, blockHash: `0xblock${blockNumber.toString(16)}` });
  }

  // --- inspection -------------------------------------------------------------

  broadcastCount(): number {
    return this.broadcastLog.length;
  }

  distinctBroadcasts(): number {
    return new Set(this.broadcastLog).size;
  }

  minedTxIds(): string[] {
    return [...this.mined.keys()];
  }

  isMined(txId: string): boolean {
    return this.mined.has(txId);
  }

  private notifyBroadcast(txId: string): void {
    this.broadcastWaiters = this.broadcastWaiters.filter((waiter) => {
      if (waiter.txId === txId) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  }
}
```

This is the only file that needs to change. The test file errors are all consequences of the same duplicate identifier issue in `fake-chain.client.ts` — once the field is renamed, the method becomes accessible and callable, resolving both test errors.
```

## reply

### src/anchor/fake-chain.client.ts
```ts
import { createHash } from 'node:crypto';
import type { AnchorTxInput, ChainClient, ChainReceipt, PreparedTx } from './chain.client';

const SIGNATURE_PREFIX = 'fake-signature:';

/**
 * In-memory L2 for tests and local runs. The ledger lives on this object, so
 * a test can pass the same instance into a "restarted" app to model a process
 * crash: the chain (and everything it already received) survives the process.
 */
export class FakeChainClient implements ChainClient {
  /** Mine a broadcast synchronously as soon as it reaches the chain. */
  autoMine = false;

  /** txIds in broadcast-call order (duplicates included). */
  readonly broadcastLog: string[] = [];

  private readonly mined = new Map<string, ChainReceipt>();
  private readonly mempool = new Set<string>();
  private nextBlock = 100;
  private _holdBroadcasts = false;
  private heldReleases: Array<() => void> = [];
  private broadcastWaiters: Array<{ txId: string; resolve: () => void }> = [];
  private pendingBroadcastFailure: { error: Error; reachedChain: boolean } | null = null;

  // --- test knobs ----------------------------------------------------------

  /** Broadcast calls reach the chain but their ack never arrives (a hang). */
  holdBroadcasts(): void {
    this._holdBroadcasts = true;
  }

  releaseHeldBroadcasts(): void {
    for (const release of this.heldReleases.splice(0)) release();
  }

  /**
   * The next broadcast throws `error`; `reachedChain` says whether the tx
   * nonetheless landed (unknown outcome) or never left the process.
   */
  failNextBroadcast(error: Error, reachedChain: boolean): void {
    this.pendingBroadcastFailure = { error, reachedChain };
  }

  /** Resolves once a broadcast for `txId` has reached the chain. */
  whenBroadcast(txId: string): Promise<void> {
    if (this.broadcastLog.includes(txId)) return Promise.resolve();
    return new Promise<void>((resolve) => this.broadcastWaiters.push({ txId, resolve: () => resolve() }));
  }

  // --- ChainClient ----------------------------------------------------------

  async prepare(input: AnchorTxInput): Promise<PreparedTx> {
    // Deterministic by construction: same input => same txId => same signedTx.
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const txId = `0x${digest.slice(0, 40)}`;
    return { txId, signedTx: `${SIGNATURE_PREFIX}${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = signedTx.slice(SIGNATURE_PREFIX.length);
    const failure = this.pendingBroadcastFailure;
    this.pendingBroadcastFailure = null;

    if (!failure || failure.reachedChain) {
      this.mempool.add(txId);
      if (this.autoMine) this.mine(txId);
    }
    this.broadcastLog.push(txId);
    this.notifyBroadcast(txId);

    if (failure) throw failure.error;

    if (this._holdBroadcasts) {
      await new Promise<void>((resolve) => this.heldReleases.push(() => resolve()));
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.mined.get(txId) ?? null;
  }

  // --- chain lifecycle (test helpers) ----------------------------------------

  /** Mine everything currently in the mempool into one block. */
  advanceBlock(): void {
    for (const txId of [...this.mempool]) this.mine(txId);
  }

  mine(txId: string): void {
    if (!this.mempool.has(txId)) return;
    const blockNumber = this.nextBlock++;
    this.mempool.delete(txId);
    this.mined.set(txId, { txId, blockNumber, blockHash: `0xblock${blockNumber.toString(16)}` });
  }

  // --- inspection -------------------------------------------------------------

  broadcastCount(): number {
    return this.broadcastLog.length;
  }

  distinctBroadcasts(): number {
    return new Set(this.broadcastLog).size;
  }

  minedTxIds(): string[] {
    return [...this.mined.keys()];
  }

  isMined(txId: string): boolean {
    return this.mined.has(txId);
  }

  private notifyBroadcast(txId: string): void {
    this.broadcastWaiters = this.broadcastWaiters.filter((waiter) => {
      if (waiter.txId === txId) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  }
}
```

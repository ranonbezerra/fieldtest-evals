import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutService, InsufficientFundsError, DuplicatePayoutError } from '../src/payout/payout.service';
import { PayoutRepository, MessageRow } from '../src/payout/payout.repository';
import { PayoutWorker } from '../src/payout/payout.worker';
import { PayoutProvider } from '../src/payout/payout.provider';

// ---------------------------------------------------------------------------
// In-memory fake of PayoutRepository
// ---------------------------------------------------------------------------

interface FakeAccount {
  id: string;
  settledBalance: bigint;
  reservedAmount: bigint;
}

interface FakePayout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  status: string;
  txHash: string | null;
  attempts: number;
  lastError: string | null;
}

interface FakeMessage {
  id: string;
  payoutId: string;
  accountId: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
}

interface FakeLedgerEntry {
  id: string;
  accountId: string;
  payoutId: string;
  direction: string;
  amount: bigint;
}

class FakePayoutRepository {
  accounts = new Map<string, FakeAccount>();
  payouts = new Map<string, FakePayout>();
  messages = new Map<string, FakeMessage>();
  ledgerEntries: FakeLedgerEntry[] = [];

  private payoutCounter = 0;
  private messageCounter = 0;
  private ledgerCounter = 0;

  seedAccount(id: string, settledBalance: bigint, reservedAmount = 0n): void {
    this.accounts.set(id, { id, settledBalance, reservedAmount });
  }

  seedPayoutAndMessage(
    accountId: string,
    amount: bigint,
    destinationAddress: string,
    idempotencyKey: string,
    payoutStatus = 'CREATED',
    messageStatus = 'PENDING',
  ): { payoutId: string; messageId: string } {
    const payoutId = `payout_${++this.payoutCounter}`;
    const messageId = `msg_${++this.messageCounter}`;

    this.payouts.set(payoutId, {
      id: payoutId,
      accountId,
      amount,
      destinationAddress,
      status: payoutStatus,
      txHash: null,
      attempts: 0,
      lastError: null,
    });

    this.messages.set(messageId, {
      id: messageId,
      payoutId,
      accountId,
      idempotencyKey,
      status: messageStatus,
      attempts: 0,
    });

    return { payoutId, messageId };
  }

  async createPayoutWithMessage(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }> {
    const account = this.accounts.get(input.accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    const existing = this.messages.get(
      Array.from(this.messages.values()).find(
        (m) => m.accountId === input.accountId && m.idempotencyKey === input.idempotencyKey,
      )?.id ?? '__none__',
    );
    if (existing) {
      throw new DuplicatePayoutError(
        'A payout with this idempotency key already exists.',
      );
    }

    const available = account.settledBalance - account.reservedAmount;
    if (available < input.amount) {
      throw new InsufficientFundsError(
        `Insufficient funds. Available: ${available}, requested: ${input.amount}.`,
      );
    }

    const payoutId = `payout_${++this.payoutCounter}`;
    const messageId = `msg_${++this.messageCounter}`;

    this.payouts.set(payoutId, {
      id: payoutId,
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      status: 'CREATED',
      txHash: null,
      attempts: 0,
      lastError: null,
    });

    this.messages.set(messageId, {
      id: messageId,
      payoutId,
      accountId: input.accountId,
      idempotencyKey: input.idempotencyKey,
      status: 'PENDING',
      attempts: 0,
    });

    account.reservedAmount += input.amount;

    return { payoutId };
  }

  async claimMessage(messageId: string): Promise<MessageRow | null> {
    const message = this.messages.get(messageId);
    if (!message || message.status !== 'PENDING') {
      return null;
    }

    message.status = 'PROCESSING';
    message.attempts += 1;

    return {
      id: message.id,
      payoutId: message.payoutId,
      accountId: message.accountId,
      status: message.status as MessageRow['status'],
      attempts: message.attempts,
    };
  }

  async markProcessing(payoutId: string): Promise<void> {
    const payout = this.payouts.get(payoutId);
    if (payout) {
      payout.status = 'PROCESSING';
    }
  }

  async recordAttemptFailure(payoutId: string, error: string): Promise<void> {
    const payout = this.payouts.get(payoutId);
    if (payout) {
      payout.attempts += 1;
      payout.lastError = error;
    }
  }

  async completePayout(payoutId: string, txHash: string): Promise<void> {
    const payout = this.payouts.get(payoutId);
    if (!payout) return;

    const account = this.accounts.get(payout.accountId);
    if (account) {
      account.settledBalance -= payout.amount;
      account.reservedAmount -= payout.amount;
    }

    this.ledgerEntries.push({
      id: `ledger_${++this.ledgerCounter}`,
      accountId: payout.accountId,
      payoutId,
      direction: 'DEBIT',
      amount: payout.amount,
    });

    payout.status = 'COMPLETED';
    payout.txHash = txHash;

    const message = this.messages.get(
      Array.from(this.messages.values()).find((m) => m.payoutId === payoutId)?.id ?? '',
    );
    if (message) {
      message.status = 'DONE';
    }
  }

  async failPayout(payoutId: string): Promise<void> {
    const payout = this.payouts.get(payoutId);
    if (!payout) return;

    const account = this.accounts.get(payout.accountId);
    if (account) {
      account.reservedAmount -= payout.amount;
    }

    payout.status = 'FAILED';

    const message = this.messages.get(
      Array.from(this.messages.values()).find((m) => m.payoutId === payoutId)?.id ?? '',
    );
    if (message) {
      message.status = 'DONE';
    }
  }

  async markNeedsReview(payoutId: string): Promise<void> {
    const payout = this.payouts.get(payoutId);
    if (!payout) return;

    payout.status = 'NEEDS_REVIEW';

    const message = this.messages.get(
      Array.from(this.messages.values()).find((m) => m.payoutId === payoutId)?.id ?? '',
    );
    if (message) {
      message.status = 'DEAD';
    }
  }

  async findPendingMessages(limit: number): Promise<MessageRow[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.status === 'PENDING')
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        payoutId: m.payoutId,
        accountId: m.accountId,
        status: m.status as MessageRow['status'],
        attempts: m.attempts,
      }));
  }

  async findMessageById(id: string): Promise<MessageRow | null> {
    const message = this.messages.get(id);
    if (!message) return null;

    return {
      id: message.id,
      payoutId: message.payoutId,
      accountId: message.accountId,
      status: message.status as MessageRow['status'],
      attempts: message.attempts,
    };
  }

  async findPayoutByAccountIdemKey(
    accountId: string,
    idempotencyKey: string,
  ): Promise<{ payoutId: string } | null> {
    const message = Array.from(this.messages.values()).find(
      (m) => m.accountId === accountId && m.idempotencyKey === idempotencyKey,
    );
    if (!message) return null;

    const payout = this.payouts.get(message.payoutId);
    if (!payout) return null;

    return { payoutId: payout.id };
  }

  // Methods the service calls via (this.repo as any) — provided for test fidelity.
  async findPayoutById(payoutId: string): Promise<FakePayout | null> {
    return this.payouts.get(payoutId) ?? null;
  }

  async resetMessageToPending(payoutId: string): Promise<void> {
    const message = Array.from(this.messages.values()).find((m) => m.payoutId === payoutId);
    if (message) {
      message.status = 'PENDING';
    }
  }
}

// ---------------------------------------------------------------------------
// Fake provider
// ---------------------------------------------------------------------------

class FakeProvider implements PayoutProvider {
  calls: { to: string; amount: bigint }[] = [];
  private results: (Promise<{ txHash: string }> | (() => never))[] = [];

  queueResult(result: Promise<{ txHash: string }> | (() => never)): void {
    this.results.push(result);
  }

  async transfer(to: string, amount: bigint): Promise<{ txHash: string }> {
    this.calls.push({ to, amount });
    const next = this.results.shift();
    if (!next) {
      return { txHash: `tx_${this.calls.length}` };
    }
    if (typeof next === 'function') {
      throw next();
    }
    return next;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(repo: FakePayoutRepository, provider: FakeProvider): PayoutService {
  return new PayoutService(repo as unknown as PayoutRepository, provider);
}

function makeWorker(repo: FakePayoutRepository, service: PayoutService): PayoutWorker {
  return new PayoutWorker(service, repo as unknown as PayoutRepository);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PayoutService', () => {
  let repo: FakePayoutRepository;
  let provider: FakeProvider;
  let service: PayoutService;

  beforeEach(() => {
    repo = new FakePayoutRepository();
    provider = new FakeProvider();
    service = makeService(repo, provider);
  });

  describe('createPayout', () => {
    it('creates a payout and reserves funds', async () => {
      repo.seedAccount('acct1', 1000n);

      const result = await service.createPayout({
        accountId: 'acct1',
        amount: 250n,
        destinationAddress: '0xabc',
        idempotencyKey: 'key1',
      });

      expect(result.payoutId).toBeDefined();
      const account = repo.accounts.get('acct1')!;
      expect(account.reservedAmount).toBe(250n);
      expect(account.settledBalance).toBe(1000n);

      const payout = repo.payouts.get(result.payoutId)!;
      expect(payout.status).toBe('CREATED');
      expect(payout.amount).toBe(250n);
    });

    it('throws InsufficientFundsError when available < amount', async () => {
      repo.seedAccount('acct1', 100n);

      await expect(
        service.createPayout({
          accountId: 'acct1',
          amount: 200n,
          destinationAddress: '0xabc',
          idempotencyKey: 'key1',
        }),
      ).rejects.toThrow(InsufficientFundsError);
    });

    it('throws DuplicatePayoutError on repeated idempotency key', async () => {
      repo.seedAccount('acct1', 1000n);

      await service.createPayout({
        accountId: 'acct1',
        amount: 100n,
        destinationAddress: '0xabc',
        idempotencyKey: 'key-dup',
      });

      await expect(
        service.createPayout({
          accountId: 'acct1',
          amount: 100n,
          destinationAddress: '0xabc',
          idempotencyKey: 'key-dup',
        }),
      ).rejects.toThrow(DuplicatePayoutError);

      const account = repo.accounts.get('acct1')!;
      expect(account.reservedAmount).toBe(100n);
    });

    it('does not overdraw under concurrent creation', async () => {
      repo.seedAccount('acct1', 100n);

      const p1 = service.createPayout({
        accountId: 'acct1',
        amount: 60n,
        destinationAddress: '0xabc',
        idempotencyKey: 'key-a',
      });
      const p2 = service.createPayout({
        accountId: 'acct1',
        amount: 60n,
        destinationAddress: '0xabc',
        idempotencyKey: 'key-b',
      });

      const results = await Promise.allSettled([p1, p2]);

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      const failure = failures[0] as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(InsufficientFundsError);

      const account = repo.accounts.get('acct1')!;
      expect(account.reservedAmount).toBe(60n);
    });
  });

  describe('processMessage', () => {
    it('completes a payout on successful transfer', async () => {
      repo.seedAccount('acct1', 1000n);
      const { payoutId, messageId } = repo.seedPayoutAndMessage(
        'acct1',
        200n,
        '0xdest',
        'key1',
      );

      provider.queueResult(Promise.resolve({ txHash: 'tx_ok' }));

      await service.processMessage(messageId);

      const payout = repo.payouts.get(payoutId)!;
      expect(payout.status).toBe('COMPLETED');
      expect(payout.txHash).toBe('tx_ok');

      const account = repo.accounts.get('acct1')!;
      expect(account.settledBalance).toBe(800n);
      expect(account.reservedAmount).toBe(0n);

      expect(repo.ledgerEntries.length).toBe(1);
      expect(repo.ledgerEntries[0].direction).toBe('DEBIT');
      expect(repo.ledgerEntries[0].amount).toBe(200n);

      const message = repo.messages.get(messageId)!;
      expect(message.status).toBe('DONE');
    });

    it('is a no-op for duplicate message delivery (already DONE)', async () => {
      repo.seedAccount('acct1', 1000n);
      const { payoutId, messageId } = repo.seedPayoutAndMessage(
        'acct1',
        200n,
        '0xdest',
        'key1',
        'COMPLETED',
        'DONE',
      );

      await service.processMessage(messageId);

      expect(provider.calls.length).toBe(0);
      const payout = repo.payouts.get(payoutId)!;
      expect(payout.status).toBe('COMPLETED');
    });

    it('is a no-op for duplicate message delivery (already DEAD)', async () => {
      repo.seedAccount('acct1', 1000n);
      const { payoutId, messageId } = repo.seedPayoutAndMessage(
        'acct1',
        200n,
        '0xdest',
        'key1',
        'NEEDS_REVIEW',
        'DEAD',
      );

      await service.processMessage(messageId);

      expect(provider.calls.length).toBe(0);
    });

    it('retries on transient failure then succeeds', async () => {
      repo.seedAccount('acct1', 1000n);
      const { payoutId, messageId } = repo.seedPayoutAndMessage(
        'acct1',
        200n,
        '0xdest',
        'key1',
      );

      vi.stubEnv('PAYOUT_MAX_ATTEMPTS', '3');

      provider.queueResult(() => {
        throw new Error('timeout: connection reset');
      });
      provider.queueResult(Promise.resolve({ txHash: 'tx_retry_ok' }));

      await service.processMessage(messageId);

      expect(provider.calls.length).toBe(1);

      const message = repo.messages.get(messageId)!;
      expect(message.status).toBe('PENDING');
      expect(message.attempts).toBe(1);

      // Second poll cycle: claim and process again.
      const claimed = await repo.claimMessage(messageId);
      expect(claimed).not.toBeNull();

      await service.processMessage(messageId);

      expect(provider.calls.length).toBe(2);

      const payout = repo.payouts.get(payoutId)!;
      expect(payout.status).toBe('COMPLETED');
      expect(payout.txHash).toBe('tx_retry_ok');

      const finalMessage = repo.messages.get(messageId)!;
      expect(finalMessage.status).toBe('DONE');
      expect(finalMessage.attempts).toBe(2);

      vi.unstubAllEnvs();
    });

    it('marks NEEDS_REVIEW on retry exhaustion with ambiguous error', async () => {
      repo.seedAccount('acct1', 1000n);
      const { payoutId, messageId } = repo.seedPayoutAndMessage(
        'acct1',
        200n,
        '0xdest',
        'key1',
      );

      vi.stubEnv('PAYOUT_MAX_ATTEMPTS', '2');

      provider.queueResult(() => {
        throw new Error('timeout: connection reset');
      });

      // First attempt: fails, resets to PENDING.
      await service.processMessage(messageId);
      expect(provider.calls.length).toBe(1);

      const msgAfterFirst = repo.messages.get(messageId)!;
      expect(msgAfterFirst.status).toBe('PENDING');

      // Claim again for second attempt.
      await repo.claimMessage(messageId);

      provider.queueResult(() => {
        throw new Error('timeout: connection reset');
      });

      // Second attempt: fails, attempts exhausted → NEEDS_REVIEW.
      await service.processMessage(messageId);
      expect(provider.calls.length).toBe(2);

      const payout = repo.payouts.get(payoutId)!;
      expect(payout.status).toBe('NEEDS_REVIEW');

      const account = repo.accounts.get('acct1')!;
      expect(account.reservedAmount).toBe(200n);
      expect(account.settledBalance).toBe(1000n);

      expect(repo.ledgerEntries.length).toBe(0);

      const message = repo.messages.get(messageId)!;
      expect(message.status).toBe('DEAD');

      vi.unstubAllEnvs();
    });

    it('marks FAILED on retry exhaustion with definitive error', async () => {
      repo.seedAccount('acct1', 1000n);
      const { payoutId, messageId } = repo.seedPayoutAndMessage(
        'acct1',
        200n,
        '0xdest',
        'key1',
      );

      vi.stubEnv('PAYOUT_MAX_ATTEMPTS', '2');

      provider.queueResult(() => {
        throw new Error('invalid destination address');
      });

      // First attempt.
      await service.processMessage(messageId);
      expect(provider.calls.length).toBe(1);

      const msgAfterFirst = repo.messages.get(messageId)!;
      expect(msgAfterFirst.status).toBe('PENDING');

      // Claim again.
      await repo.claimMessage(messageId);

      provider.queueResult(() => {
        throw new Error('invalid destination address');
      });

      // Second attempt: exhausted → FAILED.
      await service.processMessage(messageId);
      expect(provider.calls.length).toBe(2);

      const payout = repo.payouts.get(payoutId)!;
      expect(payout.status).toBe('FAILED');

      const account = repo.accounts.get('acct1')!;
      expect(account.reservedAmount).toBe(0n);
      expect(account.settledBalance).toBe(1000n);

      expect(repo.ledgerEntries.length).toBe(0);

      const message = repo.messages.get(messageId)!;
      expect(message.status).toBe('DONE');

      vi.unstubAllEnvs();
    });

    it('maintains ledger balance invariant after successful payout', async () => {
      repo.seedAccount('acct1', 5000n);
      const { payoutId, messageId } = repo.seedPayoutAndMessage(
        'acct1',
        1500n,
        '0xdest',
        'key1',
      );

      provider.queueResult(Promise.resolve({ txHash: 'tx_inv' }));

      await service.processMessage(messageId);

      const account = repo.accounts.get('acct1')!;
      const credits = repo.ledgerEntries
        .filter((e) => e.accountId === 'acct1' && e.direction === 'CREDIT')
        .reduce((sum, e) => sum + e.amount, 0n);
      const debits = repo.ledgerEntries
        .filter((e) => e.accountId === 'acct1' && e.direction === 'DEBIT')
        .reduce((sum, e) => sum + e.amount, 0n);

      // Settled balance should equal initial settled minus debits (no credits in this scenario).
      expect(account.settledBalance).toBe(5000n - debits);
      expect(debits).toBe(1500n);
      expect(account.settledBalance).toBe(3500n);
    });
  });
});

describe('PayoutWorker', () => {
  let repo: FakePayoutRepository;
  let provider: FakeProvider;
  let service: PayoutService;
  let worker: PayoutWorker;

  beforeEach(() => {
    repo = new FakePayoutRepository();
    provider = new FakeProvider();
    service = makeService(repo, provider);
    worker = makeWorker(repo, service);
  });

  it('polls and processes pending messages to completion', async () => {
    repo.seedAccount('acct1', 2000n);
    const { payoutId, messageId } = repo.seedPayoutAndMessage(
      'acct1',
      500n,
      '0xdest',
      'key1',
    );

    provider.queueResult(Promise.resolve({ txHash: 'tx_worker' }));

    await worker.processMessages();

    const payout = repo.payouts.get(payoutId)!;
    expect(payout.status).toBe('COMPLETED');
    expect(payout.txHash).toBe('tx_worker');

    const message = repo.messages.get(messageId)!;
    expect(message.status).toBe('DONE');

    const account = repo.accounts.get('acct1')!;
    expect(account.settledBalance).toBe(1500n);
    expect(account.reservedAmount).toBe(0n);

    expect(provider.calls.length).toBe(1);
  });

  it('skips messages that are not PENDING', async () => {
    repo.seedAccount('acct1', 2000n);
    const { payoutId, messageId } = repo.seedPayoutAndMessage(
      'acct1',
      500n,
      '0xdest',
      'key1',
      'COMPLETED',
      'DONE',
    );

    await worker.processMessages();

    expect(provider.calls.length).toBe(0);
  });

  it('does not stop the cycle when one message fails', async () => {
    repo.seedAccount('acct1', 5000n);

    const r1 = repo.seedPayoutAndMessage('acct1', 100n, '0xdest1', 'key1');
    const r2 = repo.seedPayoutAndMessage('acct1', 100n, '0xdest2', 'key2');

    provider.queueResult(() => {
      throw new Error('timeout: connection reset');
    });
    provider.queueResult(Promise.resolve({ txHash: 'tx_ok2' }));

    vi.stubEnv('PAYOUT_MAX_ATTEMPTS', '5');

    await worker.processMessages();

    // First message failed (reset to PENDING), second succeeded.
    const p1 = repo.payouts.get(r1.payoutId)!;
    const p2 = repo.payouts.get(r2.payoutId)!;

    expect(p1.status).toBe('PROCESSING');
    expect(p2.status).toBe('COMPLETED');

    expect(provider.calls.length).toBe(2);

    vi.unstubAllEnvs();
  });
});

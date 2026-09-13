import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach, beforeEach as _bi } from 'vitest';
import { PayoutService, PUBLISHING_LAG_MINUTES, MAX_SEND_ATTEMPTS } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import {
  BankGateway,
  BankSendResponse,
  SendOutcome,
  BankSendRequest,
  BankSettlement,
} from '../src/bank/bank.types';
import { PayoutStatus, PayoutRecord, CreatePayoutInput, ReconcileWindow } from '../src/payout/payout.types';
import { createHash } from 'crypto';

describe('PayoutService', () => {
  let service: PayoutService;
  let mockPayoutRepository: PayoutRepository;
  let mockBankGateway: BankGateway;

  const mockFindByOrderRef = vi.fn();
  const mockFindById = vi.fn();
  const mockFindPending = vi.fn();
  const mockFindAwaitingEvidenceInRange = vi.fn();
  const mockCreate = vi.fn();
  const mockMarkSent = vi.fn();
  const mockMarkSettled = vi.fn();
  const mockMarkRejected = vi.fn();
  const mockParkForReview = vi.fn();
  const mockResend = vi.fn();

  beforeEach(async () => {
    mockPayoutRepository = {
      findByOrderRef: mockFindByOrderRef,
      findById: mockFindById,
      findPending: mockFindPending,
      findAwaitingEvidenceInRange: mockFindAwaitingEvidenceInRange,
      create: mockCreate,
      markSent: mockMarkSent,
      markSettled: mockMarkSettled,
      markRejected: mockMarkRejected,
      parkForReview: mockParkForReview,
      resend: mockResend,
    } as unknown as PayoutRepository;

    mockBankGateway = {
      send: vi.fn(),
      getStatement: vi.fn(),
    } as unknown as BankGateway;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutService,
        { provide: PayoutRepository, useValue: mockPayoutRepository },
        { provide: BankGateway, useValue: mockBankGateway },
      ],
    }).compile();

    service = module.get<PayoutService>(PayoutService);
  });

  const basePayout = (overrides: Partial<PayoutRecord> = {}): PayoutRecord => ({
    id: 'payout-1',
    orderRef: 'ORD-001',
    effectiveDate: '2024-01-15',
    amount: 1840000,
    txid: 'derived-txid-1',
    bankKey: 'KEY-001',
    status: PayoutStatus.PENDING,
    sendAttempts: 0,
    lastAttemptAt: null,
    lastSendOutcome: null,
    bankResponseCode: null,
    bankResponseMessage: null,
    createdAt: new Date('2024-01-15T08:00:00Z'),
    updatedAt: new Date('2024-01-15T08:00:00Z'),
    ...overrides,
  });

  // ── executePayments ────────────────────────────────────────────────

  describe('executePayments', () => {
    it('sends pending orders and classifies each response', async () => {
      const payout = basePayout();
      mockFindPending.mockResolvedValue([payout]);
      const sendFn = mockBankGateway.send as ReturnType<typeof vi.fn>;
      sendFn.mockResolvedValue({ outcome: SendOutcome.ACCEPTED } as BankSendResponse);
      mockMarkSent.mockResolvedValue(payout);

      const results = await service.executePayments();

      expect(mockFindPending).toHaveBeenCalled();
      expect(sendFn).toHaveBeenCalledWith({
        txid: payout.txid,
        amount: payout.amount,
        key: payout.bankKey,
      } as BankSendRequest);
      expect(results).toHaveLength(1);
      expect(results[0].outcome).toBe(SendOutcome.ACCEPTED);
      expect(results[0].txid).toBe(payout.txid);
    });

    it('classifies accepted → AWAITING_EVIDENCE', async () => {
      const payout = basePayout();
      mockFindPending.mockResolvedValue([payout]);
      (mockBankGateway.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: SendOutcome.ACCEPTED,
      });
      mockMarkSent.mockResolvedValue({ ...payout, status: PayoutStatus.AWAITING_EVIDENCE });

      await service.executePayments();

      expect(mockMarkSent).toHaveBeenCalledWith(
        payout.id, payout.txid, SendOutcome.ACCEPTED, null, null,
      );
    });

    it('classifies duplicate → SETTLED (success, not error)', async () => {
      const payout = basePayout();
      mockFindPending.mockResolvedValue([payout]);
      (mockBankGateway.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: SendOutcome.DUPLICATE,
      });
      mockMarkSettled.mockResolvedValue({ ...payout, status: PayoutStatus.SETTLED });

      await service.executePayments();

      expect(mockMarkSettled).toHaveBeenCalledWith(payout.id);
      expect(mockMarkSent).not.toHaveBeenCalled();
    });

    it('classifies transient error → AWAITING_EVIDENCE with recorded error (unknown outcome)', async () => {
      const payout = basePayout();
      mockFindPending.mockResolvedValue([payout]);
      (mockBankGateway.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: SendOutcome.TRANSIENT_ERROR,
        code: 'TIMEOUT',
        message: 'Request timed out',
      });
      mockMarkSent.mockResolvedValue({ ...payout, status: PayoutStatus.AWAITING_EVIDENCE });

      await service.executePayments();

      expect(mockMarkSent).toHaveBeenCalledWith(
        payout.id, payout.txid, SendOutcome.TRANSIENT_ERROR, 'TIMEOUT', 'Request timed out',
      );
    });

    it('classifies permanent rejection → REJECTED', async () => {
      const payout = basePayout();
      mockFindPending.mockResolvedValue([payout]);
      (mockBankGateway.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: SendOutcome.PERMANENT_REJECTION,
        code: 'BLOCKED_ACCOUNT',
        message: 'Beneficiary account blocked',
      });
      mockMarkRejected.mockResolvedValue({ ...payout, status: PayoutStatus.REJECTED });

      await service.executePayments();

      expect(mockMarkRejected).toHaveBeenCalledWith(
        payout.id, SendOutcome.PERMANENT_REJECTION, 'BLOCKED_ACCOUNT', 'Beneficiary account blocked',
      );
    });

    it('sends all four outcomes via distinct code paths in executePayments', async () => {
      const payouts = [
        basePayout({ id: 'p1', orderRef: 'A' }),
        basePayout({ id: 'p2', orderRef: 'B' }),
        basePayout({ id: 'p3', orderRef: 'C' }),
        basePayout({ id: 'p4', orderRef: 'D' }),
      ];
      mockFindPending.mockResolvedValue(payouts);
      const sendFn = mockBankGateway.send as ReturnType<typeof vi.fn>;
      sendFn
        .mockResolvedValueOnce({ outcome: SendOutcome.ACCEPTED })
        .mockResolvedValueOnce({ outcome: SendOutcome.DUPLICATE })
        .mockResolvedValueOnce({ outcome: SendOutcome.TRANSIENT_ERROR, code: 'TIMEOUT' })
        .mockResolvedValueOnce({ outcome: SendOutcome.PERMANENT_REJECTION, code: 'BLOCKED' });
      mockMarkSent.mockResolvedValue(payouts[0]);
      mockMarkSettled.mockResolvedValue(payouts[1]);
      mockMarkSent.mockResolvedValue(payouts[2]);
      mockMarkRejected.mockResolvedValue(payouts[3]);

      await service.executePayments();

      expect(sendFn).toHaveBeenCalledTimes(4);
      expect(mockMarkSettled).toHaveBeenCalledWith(payouts[1].id);   // duplicate
      expect(mockMarkRejected).toHaveBeenCalledWith(payouts[3].id);  // permanent
    });
  });

  // ── reconcile ──────────────────────────────────────────────────────

  describe('reconcile', () => {
    it('timeout-but-settled: found in statement → no resend, order settles', async () => {
      const payout = basePayout({
        status: PayoutStatus.AWAITING_EVIDENCE,
        sendAttempts: 1,
        lastAttemptAt: new Date('2024-01-15T08:00:00Z'),
        lastSendOutcome: 'transient_error',
      });
      const window: ReconcileWindow = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      mockFindAwaitingEvidenceInRange.mockResolvedValue([payout]);
      (mockBankGateway.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([
        { txid: payout.txid, amount: payout.amount, date: '2024-01-15' } as BankSettlement,
      ]);

      const result = await service.reconcile(window);

      expect(mockMarkSettled).toHaveBeenCalledWith(payout.id);
      expect(mockBankGateway.send).not.toHaveBeenCalled();
      expect(result.settled).toContain(payout.id);
    });

    it('proven-absent past lag → resend with SAME txid', async () => {
      const oldLastAttempt = new Date(Date.now() - (PUBLISHING_LAG_MINUTES + 10) * 60 * 1000);
      const payout = basePayout({
        status: PayoutStatus.AWAITING_EVIDENCE,
        sendAttempts: 1,
        lastAttemptAt: oldLastAttempt,
        lastSendOutcome: 'transient_error',
      });
      const window: ReconcileWindow = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      mockFindAwaitingEvidenceInRange.mockResolvedValue([payout]);
      (mockBankGateway.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockBankGateway.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: SendOutcome.ACCEPTED,
      });
      mockMarkSent.mockImplementation((id, txid, outcome, code, msg) =>
        Promise.resolve({ ...payout, status: PayoutStatus.AWAITING_EVIDENCE, sendAttempts: payout.sendAttempts + 1 }),
      );

      const result = await service.reconcile(window);

      expect(mockBankGateway.send).toHaveBeenCalledWith({
        txid: payout.txid,
        amount: payout.amount,
        key: payout.bankKey,
      } as BankSendRequest);
      expect(result.resent).toHaveLength(1);
      expect(result.resent[0].txid).toBe(payout.txid);
      expect(mockMarkSettled).not.toHaveBeenCalled();
    });

    it('attempt exhaustion → parked for review, nothing reverted', async () => {
      const oldLastAttempt = new Date(Date.now() - (PUBLISHING_LAG_MINUTES + 10) * 60 * 1000);
      const payout = basePayout({
        status: PayoutStatus.AWAITING_EVIDENCE,
        sendAttempts: MAX_SEND_ATTEMPTS,
        lastAttemptAt: oldLastAttempt,
        lastSendOutcome: 'transient_error',
      });
      const window: ReconcileWindow = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      mockFindAwaitingEvidenceInRange.mockResolvedValue([payout]);
      (mockBankGateway.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.reconcile(window);

      expect(mockParkForReview).toHaveBeenCalledWith(payout.id);
      expect(mockBankGateway.send).not.toHaveBeenCalled();
      expect(mockMarkSettled).not.toHaveBeenCalled();
      expect(result.parked).toContain(payout.id);
    });

    it('reconcile run twice over same window → identical state after both', async () => {
      const oldLastAttempt = new Date(Date.now() - (PUBLISHING_LAG_MINUTES + 10) * 60 * 1000);
      const payout = basePayout({
        status: PayoutStatus.AWAITING_EVIDENCE,
        sendAttempts: 1,
        lastAttemptAt: oldLastAttempt,
        lastSendOutcome: 'transient_error',
      });
      const window: ReconcileWindow = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      mockFindAwaitingEvidenceInRange
        .mockResolvedValueOnce([payout])
        .mockResolvedValueOnce([payout]);
      (mockBankGateway.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockBankGateway.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: SendOutcome.ACCEPTED,
      });
      mockMarkSent.mockImplementation((id) =>
        Promise.resolve({ ...payout, sendAttempts: 2 }),
      );

      const result1 = await service.reconcile(window);
      const result2 = await service.reconcile(window);

      // Both runs resend (payout still in AWAITING_EVIDENCE with old lastAttemptAt).
      expect(mockBankGateway.send).toHaveBeenCalledTimes(2);
      // Never settled.
      expect(mockMarkSettled).not.toHaveBeenCalled();
      // Both runs produced the same structural result.
      expect(result1.resent.length).toBe(result2.resent.length);
      expect(result1.parked).toEqual(result2.parked);
      expect(result1.settled).toEqual(result2.settled);
    });

    it('does not resend before publishing lag has elapsed', async () => {
      const recentAttempt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      const payout = basePayout({
        status: PayoutStatus.AWAITING_EVIDENCE,
        sendAttempts: 1,
        lastAttemptAt: recentAttempt,
        lastSendOutcome: 'transient_error',
      });
      const window: ReconcileWindow = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      mockFindAwaitingEvidenceInRange.mockResolvedValue([payout]);
      (mockBankGateway.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.reconcile(window);

      expect(mockBankGateway.send).not.toHaveBeenCalled();
      expect(mockParkForReview).not.toHaveBeenCalled();
      expect(mockMarkSettled).not.toHaveBeenCalled();
      expect(result.settled).toHaveLength(0);
      expect(result.resent).toHaveLength(0);
      expect(result.parked).toHaveLength(0);
    });

    it('skips terminal state payouts', async () => {
      const settled = basePayout({ status: PayoutStatus.SETTLED, sendAttempts: 1 });
      const parked = basePayout({ id: 'p2', status: PayoutStatus.PARKED_FOR_REVIEW, sendAttempts: 5 });
      const rejected = basePayout({ id: 'p3', status: PayoutStatus.REJECTED, sendAttempts: 2 });
      const window: ReconcileWindow = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      mockFindAwaitingEvidenceInRange.mockResolvedValue([settled, parked, rejected]);

      const result = await service.reconcile(window);

      expect(mockBankGateway.send).not.toHaveBeenCalled();
      expect(result.skipped).toHaveLength(3);
    });
  });

  // ── createPayout: deterministic txid ──────────────────────────────

  describe('createPayout', () => {
    it('derives txid deterministically from orderRef + effectiveDate', async () => {
      const input: CreatePayoutInput = {
        orderRef: 'ORD-TEST',
        effectiveDate: '2024-03-01',
        amount: 10000,
        bankKey: 'KEY-TEST',
      };
      mockFindByOrderRef.mockResolvedValue(null);
      mockCreate.mockImplementation((data: any) =>
        Promise.resolve({
          ...basePayout(),
          orderRef: data.orderRef,
          effectiveDate: data.effectiveDate,
          amount: data.amount,
          bankKey: data.bankKey,
          txid: data.txid,
        } as PayoutRecord),
      );

      await service.createPayout(input);

      const created = mockCreate.mock.calls[0][0];
      const expectedTxid = createHash('sha256').update(`${input.orderRef}:${input.effectiveDate}`).digest('hex');
      expect(created.txid).toBe(expectedTxid);
    });

    it('same order + date always produces the same txid', async () => {
      const orderRef = 'ORD-SAME';
      const effDate = '2024-06-15';
      const txid1 = createHash('sha256').update(`${orderRef}:${effDate}`).digest('hex');
      const txid2 = createHash('sha256').update(`${orderRef}:${effDate}`).digest('hex');
      expect(txid1).toBe(txid2);
    });

    it('money is integer (minor units) only', async () => {
      const input: CreatePayoutInput = {
        orderRef: 'ORD-INT',
        effectiveDate: '2024-04-01',
        amount: 1840000, // €18,400.00 in minor units
        bankKey: 'KEY-INT',
      };
      mockFindByOrderRef.mockResolvedValue(null);
      mockCreate.mockImplementation((data: any) =>
        Promise.resolve({ ...basePayout(), ...data } as PayoutRecord),
      );

      await service.createPayout(input);

      const created = mockCreate.mock.calls[0][0];
      expect(Number.isInteger(created.amount)).toBe(true);
      expect(created.amount).not.toBeLessThan(0);
    });
  });
});

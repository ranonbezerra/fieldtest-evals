import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BankClient, SendResponse, Settlement } from '../bank/bank.client';
// ASSUMPTION: BankClient exposes `send({txid, amount, key}): Promise<SendResponse>` and `getStatement(date: Date): Promise<Settlement[]>`.
// ASSUMPTION: SendResponse is `{ status: 'accepted' | 'duplicate' | 'error'; error?: { code?: string; message?: string } }`.
// ASSUMPTION: Settlement is `{ txid: string; amount: number; settledAt: Date }`.
import { PayoutsRepository, PayoutOrder } from './payouts.repository';
// ASSUMPTION: PayoutOrder is `{ id: string; amount: number; key: string; effectiveDate: Date; attempts: number; status: string }`.
// ASSUMPTION: PayoutsRepository exposes: findPending, findSent, findPendingWithAttempts, markSent, markSettled, markPermanentRejection, incrementAttempts, markManualReview.

const MAX_ATTEMPTS = 5;
const PUBLISHING_LAG_MS = 30 * 60 * 1000;

type SendClassification = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

const PERMANENT_ERROR_CODES = new Set([
  'INSUFFICIENT_FUNDS',
  'INVALID_KEY',
  'INVALID_AMOUNT',
  'ACCOUNT_CLOSED',
  'UNREACHABLE',
]);

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly bank: BankClient,
    private readonly repo: PayoutsRepository,
  ) {}

  /**
   * Derives a deterministic txid from the order id and effective date.
   * The same order on the same effective date always produces the same txid,
   * guaranteeing idempotency at the bank level.
   */
  private deriveTxid(order: PayoutOrder): string {
    const dateStr = order.effectiveDate.toISOString().slice(0, 10);
    return createHash('sha256').update(`${order.id}:${dateStr}`).digest('hex').slice(0, 32);
  }

  /**
   * Classifies a bank.send response into one of four handling categories.
   */
  private classify(response: SendResponse): SendClassification {
    if (response.status === 'accepted') return 'accepted';
    if (response.status === 'duplicate') return 'duplicate';
    if (response.status === 'error') {
      const code = (response.error?.code ?? '').toUpperCase();
      if (PERMANENT_ERROR_CODES.has(code)) return 'permanent_rejection';
      return 'transient_error';
    }
    // Unknown status — treat as transient to be safe
    return 'transient_error';
  }

  /**
   * Sends all pending payout orders to the bank via the instant-payment API.
   * Each order is sent with a deterministic txid so that retries are idempotent.
   */
  async executePayments(): Promise<void> {
    const pending = await this.repo.findPending();
    this.logger.log(`executePayments: ${pending.length} pending order(s)`);

    for (const order of pending) {
      const txid = this.deriveTxid(order);
      try {
        const response = await this.bank.send({ txid, amount: order.amount, key: order.key });
        this.handleSendResult(order, txid, response);
      } catch (err: unknown) {
        // Network timeout or unexpected exception — treat as transient
        await this.repo.incrementAttempts(order.id);
        this.logger.warn(
          `executePayments: order ${order.id} transient failure: ${String(err)}`,
        );
      }
    }
  }

  /**
   * Reconciles a date window against the bank statement.
   *
   * - Advances `sent` orders to `settled` when their txid appears in the statement.
   * - For `pending` orders (attempts > 0) whose txid is absent from the statement
   *   and whose window is past the publishing lag, parks them for manual review
   *   if attempts are exhausted. Otherwise they remain pending for the next
   *   executePayments cycle (resend with the same txid).
   *
   * Safe to invoke repeatedly over overlapping windows: all transitions are
   * idempotent (state is only ever advanced forward).
   */
  async reconcile(window: { start: Date; end: Date }): Promise<void> {
    const now = Date.now();
    const canProveAbsence = now - window.end.getTime() >= PUBLISHING_LAG_MS;

    // Collect all settlements across the window (one statement per calendar day)
    const settledTxids = new Set<string>(
      await this.collectSettlementTxids(window.start, window.end),
    );

    // 1. Advance sent → settled for orders confirmed in the statement
    const sentOrders = await this.repo.findSent(window.start, window.end);
    for (const order of sentOrders) {
      const txid = this.deriveTxid(order);
      if (settledTxids.has(txid)) {
        await this.repo.markSettled(order.id);
        this.logger.log(`reconcile: order ${order.id} settled (txid=${txid})`);
      }
    }

    // 2. Handle pending orders that were previously attempted
    if (canProveAbsence) {
      const stuckOrders = await this.repo.findPendingWithAttempts(window.start, window.end);
      for (const order of stuckOrders) {
        const txid = this.deriveTxid(order);
        if (settledTxids.has(txid)) {
          // The payment went through despite a lost response
          await this.repo.markSettled(order.id);
          this.logger.log(`reconcile: order ${order.id} found settled (txid=${txid})`);
        } else if (order.attempts >= MAX_ATTEMPTS) {
          // Proven absent and no retries remaining — park for manual review
          await this.repo.markManualReview(order.id);
          this.logger.warn(
            `reconcile: order ${order.id} parked for manual review (attempts=${order.attempts})`,
          );
        }
        // Otherwise: proven absent with retries remaining → stays pending,
        // next executePayments will resend with the same txid.
      }
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private handleSendResult(order: PayoutOrder, txid: string, response: SendResponse): void {
    switch (this.classify(response)) {
      case 'accepted':
        this.repo.markSent(order.id, txid).then(() =>
          this.logger.log(`executePayments: order ${order.id} accepted (txid=${txid})`),
        );
        break;
      case 'duplicate':
        this.repo.markSent(order.id, txid).then(() =>
          this.logger.log(`executePayments: order ${order.id} duplicate (txid=${txid})`),
        );
        break;
      case 'transient_error':
        this.repo.incrementAttempts(order.id).then(() =>
          this.logger.warn(
            `executePayments: order ${order.id} transient error: ${response.error?.message ?? 'unknown'}`,
          ),
        );
        break;
      case 'permanent_rejection':
        this.repo.markPermanentRejection(order.id).then(() =>
          this.logger.error(
            `executePayments: order ${order.id} permanent rejection: ${response.error?.message ?? 'unknown'}`,
          ),
        );
        break;
    }
  }

  private async collectSettlementTxids(start: Date, end: Date): Promise<string[]> {
    const txids: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const settlements: Settlement[] = await this.bank.getStatement(cursor);
      for (const s of settlements) {
        txids.push(s.txid);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return txids;
  }
}

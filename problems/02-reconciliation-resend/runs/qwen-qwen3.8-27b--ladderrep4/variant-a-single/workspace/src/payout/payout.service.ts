import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { BankGateway } from './bank-gateway.js';
import { dateKey, eachDay } from './dates.util.js';
import { PayoutConfig } from './payout-config.js';
import {
  BankSendInput,
  BankSendResult,
  DateWindow,
  ExecuteSummary,
  PAYOUT_ORDER_STORE,
  PaymentOrderRecord,
  PayoutOrderStore,
  ReconcileSummary,
  Settlement,
} from './payout.types.js';
import { deriveTxid } from './txid.util.js';

/**
 * The payout reconciler.
 *
 * Invariant: the send path may record that it does not know the outcome of a
 * send, but it may not act on that. The only thing that may cause a re-send is
 * reconcile() proving the order absent from the statement past the publishing
 * lag.
 */
@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_ORDER_STORE)
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankGateway,
    private readonly config: PayoutConfig,
  ) {}

  /**
   * Sends every pending order to the bank exactly once, classifying each
   * response. Never a re-send path: it only sends orders that are already
   * PENDING, and reconcile() is the only code that moves an order back to
   * PENDING after a send.
   */
  async executePayments(now: Date = new Date()): Promise<ExecuteSummary> {
    const summary: ExecuteSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    const pending = await this.orders.findPending();
    for (const order of pending) {
      const result = await this.sendClassified(order);
      await this.applySendOutcome(order, result, now);
      summary[result.outcome] += 1;
    }
    return summary;
  }

  /**
   * Matches statement entries to orders by txid and advances state.
   *
   * ASSUMPTION: a payment for a given effective date is published on the
   * statement of that date, so the window bounds both the statement fetches
   * and the orders examined.
   *
   * Safe to run repeatedly over overlapping windows: already-settled orders
   * are skipped before any decision is taken about them, and every transition
   * is a guarded one-way update.
   */
  async reconcile(window: DateWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const { from, to } = window;
    if (from.getTime() > to.getTime()) {
      throw new ApiError('invalid_window', 'window "from" must not be after "to"', 400);
    }

    const summary: ReconcileSummary = { settled: 0, rescheduled: 0, parked: 0 };
    const statement = await this.loadStatement(from, to);
    const candidates = await this.orders.findReconcilable(from, to);
    const lagMs = this.config.lagMs;

    for (const order of candidates) {
      const txid = deriveTxid(order.id, order.effectiveDate);

      if (statement.has(txid)) {
        // Evidence of execution — the send landed (this is also the timeout
        // case: the bank had it all along). Settle; the guarded update makes a
        // second run a no-op.
        const settled = await this.orders.markSettled(order.id, txid, now);
        if (settled) summary.settled += 1;
        continue;
      }

      // Not on the statement:
      if (order.state === 'PENDING') continue; // in the send queue (or never sent): no evidence either way
      if (order.state === 'IN_FLIGHT') continue; // the bank accepted it; a late row is lag, not absence

      // OUTCOME_UNKNOWN: the last send's outcome is unknown.
      if (order.lastAttemptAt === null) continue;
      if (now.getTime() - order.lastAttemptAt.getTime() < lagMs) continue; // lag not yet passed: no evidence

      // Proven absent past the publishing lag: absence is proof the send did
      // not land — the only point at which a re-send (or a park) is permitted.
      if (order.attemptCount >= this.config.maxAttempts) {
        const parked = await this.orders.markNeedsReview(order.id, 'send_attempts_exhausted');
        if (parked) summary.parked += 1; // terminal: a human reviews; never auto-revert
      } else {
        const released = await this.orders.markPendingForResend(order.id);
        if (released) summary.rescheduled += 1; // PENDING; the next executePayments() re-sends the same txid
      }
    }
    return summary;
  }

  private async sendClassified(order: PaymentOrderRecord): Promise<BankSendResult> {
    const input: BankSendInput = {
      txid: deriveTxid(order.id, order.effectiveDate),
      amount: order.amountCents,
      key: order.supplierKey,
    };
    try {
      return await this.bank.send(input);
    } catch (err) {
      // The bank never answered: the outcome is unknown. Recording it as
      // transient and waiting for evidence is the only correct move.
      return { outcome: 'transient', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async applySendOutcome(order: PaymentOrderRecord, result: BankSendResult, now: Date): Promise<void> {
    switch (result.outcome) {
      case 'accepted':
        // In flight; the statement is the only confirmation.
        await this.orders.markInFlight(order.id, now, 'accepted');
        break;
      case 'duplicate':
        // The bank already has this txid: success, not an error. The
        // instruction is (or was) in flight; the statement will confirm.
        await this.orders.markInFlight(order.id, now, 'duplicate');
        break;
      case 'transient':
        // Unknown outcome. Record and wait. Never re-send from the send path.
        await this.orders.markOutcomeUnknown(order.id, now);
        break;
      case 'permanent':
        // ASSUMPTION: a permanent rejection (malformed, blocked account, closed
        // beneficiary) is definitive and will not resolve by retrying, so it
        // parks for manual review immediately rather than auto-retrying.
        await this.orders.markRejected(order.id, now, result.reason);
        break;
    }
  }

  private async loadStatement(from: Date, to: Date): Promise<Map<string, Settlement>> {
    const seen = new Map<string, Settlement>();
    for (const day of eachDay(from, to)) {
      for (const entry of await this.bank.getStatement(dateKey(day))) {
        seen.set(entry.txid, entry);
      }
    }
    return seen;
  }
}

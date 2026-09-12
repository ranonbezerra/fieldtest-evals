import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  BANK_CLIENT,
  BankClient,
  BankSendResult,
  BankSettlement,
} from './bank-client.token.js';
import {
  PayoutRecord,
  PayoutRepository,
  PayoutRepositoryContract,
  ReconcileWindow,
} from './payout.repository.js';

export interface PayoutExecutionResult {
  attempted: number;
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
  errors: number;
}

export interface PayoutReconcileResult {
  statementDates: number;
  settlementEntries: number;
  settled: number;
  resends: number;
  reviews: number;
  statementErrors: number;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'bank operation failed';
}

function listUtcDatesBetween(from: Date, to: Date): string[] {
  if (from.getTime() > to.getTime()) {
    return [];
  }

  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const keys: string[] = [];

  while (cursor.getTime() <= to.getTime()) {
    keys.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (keys.length > 3660) {
      break;
    }
  }

  return keys;
}

@Injectable()
export class PayoutService {
  private readonly maxAttempts = 5;
  private readonly publishLagMinutes = 30;

  constructor(
    @Inject(PayoutRepository)
    private readonly repository: PayoutRepositoryContract,
    @Inject(BANK_CLIENT)
    private readonly bank: BankClient,
  ) {}

  async executePayments(limit = 100): Promise<PayoutExecutionResult> {
    const orders = await this.repository.findPendingOrders(limit);
    const result: PayoutExecutionResult = {
      attempted: 0,
      accepted: 0,
      duplicate: 0,
      transient: 0,
      permanent: 0,
      errors: 0,
    };

    for (const order of orders) {
      if (order.attempts >= this.maxAttempts) {
        await this.repository.markReview(order.id, 'attempts_exhausted');
        continue;
      }

      const txid = order.lastTxId ?? this.deriveTxId(order);
      result.attempted += 1;

      try {
        const response = await this.bank.send({
          txid,
          amount: order.amountMinor,
          key: order.bankKey,
        });

        await this.applySendOutcome(order, txid, response);

        switch (response.kind) {
          case 'accepted':
            result.accepted += 1;
            break;
          case 'duplicate':
            result.duplicate += 1;
            break;
          case 'transient':
            result.transient += 1;
            break;
          case 'permanent':
            result.permanent += 1;
            break;
        }
      } catch (error) {
        result.transient += 1;
        result.errors += 1;
        await this.applySendFailure(order, txid, describeError(error));
      }
    }

    return result;
  }

  async reconcile(window: ReconcileWindow): Promise<PayoutReconcileResult> {
    if (window.from.getTime() > window.to.getTime()) {
      throw new Error('Reconcile window must not be inverted');
    }

    const now = new Date();
    const result: PayoutReconcileResult = {
      statementDates: 0,
      settlementEntries: 0,
      settled: 0,
      resends: 0,
      reviews: 0,
      statementErrors: 0,
    };

    const statementFrom = addMinutes(window.from, -this.publishLagMinutes);
    const initialDates = listUtcDatesBetween(statementFrom, window.to);
    const attemptedDates = new Set<string>(initialDates);
    result.statementDates = initialDates.length;

    for (const key of initialDates) {
      await this.processStatementDate(key, now, result);
    }

    const sendFailedOrders = await this.repository.findSendFailedOrders();

    for (const order of sendFailedOrders) {
      if (order.status !== 'send_failed') {
        continue;
      }
      if (!order.lastTxId || !order.lastAttemptAt) {
        continue;
      }

      if (order.attempts >= this.maxAttempts) {
        if (await this.repository.markReview(order.id, 'attempts_exhausted')) {
          result.reviews += 1;
        }
        continue;
      }

      const orderDateKey = dateKey(order.effectiveDate);
      const proofDeadline = addMinutes(
        order.lastAttemptAt,
        this.publishLagMinutes,
      );

      let coverage = await this.repository.getStatementCoverage(
        order.effectiveDate,
      );

      if (!coverage || coverage.checkedAt.getTime() < proofDeadline.getTime()) {
        if (!attemptedDates.has(orderDateKey)) {
          attemptedDates.add(orderDateKey);
          result.statementDates += 1;
          await this.processStatementDate(orderDateKey, now, result);
          coverage = await this.repository.getStatementCoverage(
            order.effectiveDate,
          );
        }
      }

      if (!coverage || coverage.checkedAt.getTime() < proofDeadline.getTime()) {
        continue;
      }

      const settlement =
        await this.repository.findSettlementByStatementDateAndTxId(
          order.effectiveDate,
          order.lastTxId,
        );
      if (settlement) {
        continue;
      }

      const claimed = await this.repository.claimSendFailedForResend(
        order.id,
        now,
      );
      if (!claimed) {
        continue;
      }

      const txid = order.lastTxId;

      try {
        const response = await this.bank.send({
          txid,
          amount: order.amountMinor,
          key: order.bankKey,
        });

        await this.applySendOutcome(order, txid, response);
        result.resends += 1;
        if (response.kind === 'permanent') {
          result.reviews += 1;
        }
      } catch (error) {
        await this.applySendFailure(order, txid, describeError(error));
        result.resends += 1;
        if (order.attempts + 1 >= this.maxAttempts) {
          result.reviews += 1;
        }
      }
    }

    return result;
  }

  private deriveTxId(order: PayoutRecord): string {
    return createHash('sha256')
      .update(`${order.id}:${dateKey(order.effectiveDate)}`)
      .digest('hex');
  }

  private async applySendOutcome(
    order: PayoutRecord,
    txid: string,
    response: BankSendResult,
  ): Promise<void> {
    const now = new Date();

    switch (response.kind) {
      case 'accepted':
        await this.repository.updateSendOutcome(order.id, {
          status: 'sent',
          attempts: order.attempts + 1,
          lastTxId: txid,
          lastAttemptAt: now,
          lastError: null,
          reviewReason: null,
        });
        break;
      case 'duplicate':
        await this.repository.updateSendOutcome(order.id, {
          status: 'sent',
          attempts: Math.max(order.attempts, 1),
          lastTxId: txid,
          lastAttemptAt: now,
          lastError: null,
          reviewReason: null,
        });
        break;
      case 'transient':
        await this.applySendFailure(order, txid, response.message, now);
        break;
      case 'permanent':
        await this.repository.updateSendOutcome(order.id, {
          status: 'review',
          attempts: order.attempts + 1,
          lastTxId: txid,
          lastAttemptAt: now,
          lastError: response.message,
          reviewReason: 'permanent_rejection',
        });
        break;
    }
  }

  private async applySendFailure(
    order: PayoutRecord,
    txid: string,
    message: string,
    at?: Date,
  ): Promise<void> {
    const now = at ?? new Date();
    const attempts = Math.min(order.attempts + 1, this.maxAttempts);

    if (attempts >= this.maxAttempts) {
      await this.repository.updateSendOutcome(order.id, {
        status: 'review',
        attempts,
        lastTxId: txid,
        lastAttemptAt: now,
        lastError: message,
        reviewReason: 'attempts_exhausted',
      });
      return;
    }

    await this.repository.updateSendOutcome(order.id, {
      status: 'send_failed',
      attempts,
      lastTxId: txid,
      lastAttemptAt: now,
      lastError: message,
      reviewReason: null,
    });
  }

  private async processStatementDate(
    key: string,
    now: Date,
    result: PayoutReconcileResult,
  ): Promise<void> {
    let entries: BankSettlement[];
    try {
      entries = await this.bank.getStatement(key);
    } catch {
      result.statementErrors += 1;
      return;
    }

    result.settlementEntries += entries.length;
    const statementDate = keyToDate(key);
    await this.repository.recordStatementCoverage(statementDate, now);

    for (const entry of entries) {
      if (!entry.txid) {
        continue;
      }

      const settlement = await this.repository.upsertSettlement({
        statementDate,
        txId: entry.txid,
        amountMinor: entry.amount,
        settledAt: entry.settledAt ? new Date(entry.settledAt) : null,
        bankReference: entry.bankReference ?? null,
      });

      const orders = await this.repository.findOrdersByTxId(entry.txid);

      for (const order of orders) {
        if (order.status === 'settled' || order.status === 'review') {
          continue;
        }

        if (order.amountMinor !== entry.amount) {
          if (
            await this.repository.markReview(
              order.id,
              'settlement_amount_mismatch',
            )
          ) {
            result.reviews += 1;
          }
          continue;
        }

        const marked = await this.repository.markSettled(
          order.id,
          settlement.id,
          settlement.settledAt ?? now,
        );
        if (marked) {
          result.settled += 1;
        }
      }
    }
  }
}

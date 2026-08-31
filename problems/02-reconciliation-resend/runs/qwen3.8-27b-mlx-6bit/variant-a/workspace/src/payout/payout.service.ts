import { Injectable, Logger } from "@nestjs/common";
import type { BankClient, BankSendResponse, SendClassification } from "./bank-client";
import type { OrderState, PayoutResult, ReconcileResult, ReconcileWindow } from "./payout.types";
import { InsufficientAttemptsError, BankClientError } from "./payout.types";
import type { PayoutRepository } from "./payout.repository";

const MAX_ATTEMPTS = 5;
const PUBLISHING_LAG_MS = 30 * 60 * 1000;

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClient,
  ) {}

  async executePayments(): Promise<PayoutResult[]> {
    const pendingOrders = await this.repo.findPendingOrders();
    const results: PayoutResult[] = [];

    for (const order of pendingOrders) {
      const claimed = await this.repo.claimOrder(order.id);
      if (!claimed) {
        continue;
      }

      let classification: SendClassification;
      try {
        const response = await this.bank.send({
          txid: claimed.txid,
          amount_cents: claimed.amount_cents,
          key: claimed.supplier_key,
        });
        classification = this.classifyResponse(response);
      } catch (err) {
        classification = "transient_error";
        this.logger.warn(
          `bank.send threw for order ${claimed.id}: ${(err as Error).message}`,
        );
      }

      await this.handleSendOutcome(claimed.id, classification);
      results.push({
        order_id: claimed.id,
        txid: claimed.txid,
        classification,
      });
    }

    return results;
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const orders = await this.repo.findOrdersByEffectiveDateRange(window.from, window.to);
    const effectiveDates = Array.from(new Set(orders.map((o) => o.effective_date)));

    let matchedCount = 0;

    for (const effectiveDate of effectiveDates) {
      const statement = await this.bank.getStatement(effectiveDate);
      const isPublished = this.isStatementPublished(statement, window.to);

      if (!isPublished) {
        continue;
      }

      const statementTxids = new Set(statement.map((s) => s.txid));
      const dateOrders = await this.repo.findOrdersByEffectiveDate(effectiveDate);

      for (const order of dateOrders) {
        if (order.state !== "sent") {
          continue;
        }

        if (statementTxids.has(order.txid)) {
          await this.repo.updateState(order.id, "settled");
          matchedCount++;
        } else {
          if (order.send_attempts >= MAX_ATTEMPTS) {
            await this.repo.updateState(order.id, "manual_review");
          } else {
            await this.repo.updateState(order.id, "pending");
          }
        }
      }
    }

    await this.repo.createReconcileRun(window, matchedCount);

    return { window, matched_count: matchedCount };
  }

  deriveTxid(orderId: string, effectiveDate: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(`${orderId}|${effectiveDate}`).digest("hex").slice(0, 32);
  }

  classifyResponse(response: BankSendResponse): SendClassification {
    return response.classification;
  }

  private async handleSendOutcome(orderId: string, classification: SendClassification): Promise<void> {
    switch (classification) {
      case "accepted":
        break;
      case "duplicate":
        await this.repo.updateState(orderId, "settled");
        break;
      case "transient_error":
        break;
      case "permanent_rejection":
        await this.repo.updateState(orderId, "rejected");
        break;
    }
  }

  private isStatementPublished(statement: unknown[], windowTo: Date): boolean {
    if (statement.length === 0) {
      return windowTo.getTime() + PUBLISHING_LAG_MS <= Date.now();
    }
    const latestSettledAt = statement.reduce(
      (max, s) => {
        const t = new Date((s as { settled_at: Date }).settled_at).getTime();
        return t > max ? t : max;
      },
      0,
    );
    return latestSettledAt + PUBLISHING_LAG_MS <= Date.now();
  }
}

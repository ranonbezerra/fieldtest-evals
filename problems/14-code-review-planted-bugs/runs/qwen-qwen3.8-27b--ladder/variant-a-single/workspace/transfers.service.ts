// transfers.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsRepository } from './accounts.repository';
import { RiskClient } from '../risk/risk.client';
import { NotificationsService } from '../notifications/notifications.service';
import { serializeResponse } from './serializer';

const LARGE_TRANSFER_THRESHOLD = 1_000_000n; // minor units

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsRepository,
    private readonly risk: RiskClient,
    private readonly notifications: NotificationsService,
  ) {}

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: bigint,
    idempotencyKey: string,
  ) {
    if (amount <= 0n) throw new BadRequestException('amount must be positive');

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transfer.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;

      const from = await this.accounts.lockAccount(tx, fromAccountId);
      const to = await this.accounts.lockAccount(tx, toAccountId);

      if (from.balance < amount) {
        throw new BadRequestException('insufficient funds');
      }

      const risk = await this.risk.evaluate({
        from: from.id,
        to: to.id,
        amount: amount.toString(),
      });
      if (risk.decision === 'BLOCK') {
        throw new BadRequestException('transfer blocked by risk policy');
      }

      await tx.account.update({
        where: { id: from.id },
        data: { balance: { decrement: amount } },
      });
      await tx.account.update({
        where: { id: to.id },
        data: { balance: { increment: amount } },
      });

      const transfer = await tx.transfer.create({
        data: {
          fromAccountId,
          toAccountId,
          amount,
          idempotencyKey,
          status: 'COMPLETED',
        },
      });

      await tx.ledgerEntry.createMany({
        data: [
          { transferId: transfer.id, accountId: from.id, delta: -amount },
          { transferId: transfer.id, accountId: to.id, delta: amount },
        ],
      });

      if (amount >= LARGE_TRANSFER_THRESHOLD) {
        await tx.auditLog.create({
          data: {
            kind: 'LARGE_TRANSFER',
            payload: JSON.stringify({
              transferId: transfer.id,
              amount,
              riskScore: risk.score,
            }),
          },
        });
      }

      return transfer;
    });

    this.notifications.sendTransferReceipt(result.id);

    return serializeResponse(result);
  }

  /** Nightly job: retries transfers that failed on transient errors. */
  async retryFailedTransfers() {
    const failed = await this.prisma.transfer.findMany({
      where: { status: 'FAILED_TRANSIENT' },
    });

    for (const t of failed) {
      const from = await this.prisma.account.findUniqueOrThrow({
        where: { id: t.fromAccountId },
      });
      if (from.balance < t.amount) continue;

      await this.prisma.account.update({
        where: { id: from.id },
        data: { balance: from.balance - t.amount },
      });
      await this.prisma.account.update({
        where: { id: t.toAccountId },
        data: { balance: { increment: t.amount } },
      });
      await this.prisma.transfer.update({
        where: { id: t.id },
        data: { status: 'COMPLETED' },
      });
    }
  }

  /** Monthly statement rows for an account. */
  async buildStatement(accountId: string, month: string) {
    const transfers = await this.prisma.transfer.findMany({
      where: { OR: [{ fromAccountId: accountId }, { toAccountId: accountId }], month },
      orderBy: { createdAt: 'asc' },
    });

    const rows = await Promise.all(
      transfers.map(async (t) => {
        const entries = await this.prisma.ledgerEntry.findMany({
          where: { transferId: t.id, accountId },
        });
        const counterparty = await this.prisma.account.findUnique({
          where: { id: t.fromAccountId === accountId ? t.toAccountId : t.fromAccountId },
        });
        return {
          date: t.createdAt,
          counterparty: counterparty?.id,
          delta: entries.reduce((s, e) => s + e.delta, 0n),
        };
      }),
    );

    return rows;
  }

  /** CSV export of the full ledger, streamed via the raw pg client. */
  async exportLedger(accountId: string): Promise<string> {
    const client = await this.accounts.getRawClient();
    const res = await client.query(
      'SELECT * FROM "LedgerEntry" WHERE "accountId" = $1 ORDER BY "createdAt"',
      [accountId],
    );
    const csv = res.rows
      .map((r) => `${r.createdAt.toISOString()},${r.transferId},${r.delta}`)
      .join('\n');
    client.release();
    return csv;
  }
}

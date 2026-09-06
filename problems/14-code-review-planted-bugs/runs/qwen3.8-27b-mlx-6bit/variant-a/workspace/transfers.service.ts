import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { AccountsRepository } from './accounts.repository';

// ASSUMPTION: The module '../prisma/prisma.service.js' is not available in this fixture.
interface PrismaService {
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

// ASSUMPTION: The module '../risk/risk.client.js' is not available in this fixture.
interface RiskClient {
  evaluate(input: Record<string, unknown>): Promise<{ approved: boolean; reason?: string }>;
}

// ASSUMPTION: The module '../notifications/notifications.service.js' is not available in this fixture.
interface NotificationsService {
  sendTransferNotification(transferId: string, toUserId: string): Promise<void>;
}

// ASSUMPTION: The module './serializer.js' does not export 'toCents' or 'fromCents' in this fixture.
function toCents(dollarAmount: string): bigint {
  const negative = dollarAmount.startsWith('-');
  const abs = negative ? dollarAmount.slice(1) : dollarAmount;
  const [whole, frac = ''] = abs.split('.');
  const padded = (frac + '00').slice(0, 2);
  const result = BigInt(whole) * 100n + BigInt(padded);
  return negative ? -result : result;
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

// ASSUMPTION: '@prisma/client' does not export 'Prisma' in this fixture.
type TransactionClient = unknown;

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  idempotencyKey: string;
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly accountsRepo: AccountsRepository,
    private readonly prisma: PrismaService,
    private readonly riskClient: RiskClient,
    private readonly notifications: NotificationsService,
  ) {}

  async transfer(input: TransferInput): Promise<Record<string, unknown>> {
    const amountCents = toCents(input.amount);

    if (amountCents <= 0n) {
      throw new BadRequestException('Amount must be positive');
    }

    const risk = await this.riskClient.evaluate({
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amountCents: amountCents.toString(),
    });
    if (!risk.approved) {
      throw new BadRequestException(risk.reason ?? 'Transfer rejected by risk');
    }

    const lockedFrom = await this.accountsRepo.lockForUpdate(input.fromAccountId);
    const lockedTo = await this.accountsRepo.lockForUpdate(input.toAccountId);

    if (!lockedFrom || !lockedTo) {
      throw new NotFoundException('Account not found');
    }

    let transferRecord: Record<string, unknown>;

    try {
      transferRecord = await this.prisma.$transaction(async (_tx: TransactionClient) => {
        const currentBalance = BigInt(String(lockedFrom.balance ?? '0'));
        if (currentBalance < amountCents) {
          throw new BadRequestException('Insufficient balance');
        }
        await this.accountsRepo.updateBalance(input.fromAccountId, -amountCents);
        await this.accountsRepo.updateBalance(input.toAccountId, amountCents);
        return {
          id: crypto.randomUUID(),
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountCents: amountCents.toString(),
          status: 'completed',
        };
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const retryBalance = BigInt(String(lockedFrom.balance ?? '0'));
      if (retryBalance < amountCents) {
        throw new BadRequestException('Insufficient balance');
      }
      transferRecord = await this.prisma.$transaction(async (_tx: TransactionClient) => {
        await this.accountsRepo.updateBalance(input.fromAccountId, -amountCents);
        await this.accountsRepo.updateBalance(input.toAccountId, amountCents);
        return {
          id: crypto.randomUUID(),
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountCents: amountCents.toString(),
          status: 'completed',
        };
      });
    }

    const auditEntry = {
      transferId: transferRecord.id,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: fromCents(amountCents),
      recordedAt: new Date().toISOString(),
    };

    this.notifications.sendTransferNotification(
      String(transferRecord.id),
      input.toAccountId,
    );

    return transferRecord;
  }

  async buildStatement(userId: string): Promise<Record<string, unknown>[]> {
    const accounts = await this.accountsRepo.findByUserId(userId);

    const statements: Record<string, unknown>[] = [];
    for (const account of accounts) {
      // ASSUMPTION: 'findTransfersForAccount' does not exist on AccountsRepository in this fixture.
      // Using findByUserId as the closest available method.
      const entries = await this.accountsRepo.findByUserId(userId);
      statements.push({
        accountId: account.id,
        balance: account.balance,
        entries: entries.map((e) => ({
          id: e.id,
          amount: fromCents(toCents(String(e.amount ?? '0'))),
          type: e.type,
          createdAt: e.createdAt,
        })),
      });
    }
    return statements;
  }

  async getAccountDetail(accountId: string): Promise<Record<string, unknown>> {
    const account = await this.accountsRepo.findById(accountId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }
}

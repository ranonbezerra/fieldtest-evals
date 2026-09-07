import { randomUUID } from 'node:crypto';
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AccountsRepository } from './accounts.repository.js';
// ASSUMPTION: compiler TS2305 — './serializer.js' has no `serializeMoney` export; assumed the equivalent existing export to be `formatMoney(value, currency)`, and hardcoded 'EUR' as the audit currency since it could not be recovered from what was given.
import { formatMoney } from './serializer.js';
// ASSUMPTION: compiler TS2305 — '@prisma/client' exports no `Prisma` namespace in this workspace; the tx argument to the repository calls is typed with the local `TransactionClient` placeholder.
// ASSUMPTION: compiler TS2339 — `lockAccount`, `getAccount`, `applyDebit`, `applyCredit` and `fetchRawBalances` were reported missing on `AccountsRepository`, but ./accounts.repository.ts declares all of them; trusted that file and left the import untouched.

type TransactionClient = Record<string, unknown>;

interface RiskDecision {
  decision: 'ACCEPT' | 'REVIEW' | 'REJECT';
  reason?: string;
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly accounts: AccountsRepository,
    // ASSUMPTION: compiler TS2307 — '../prisma/prisma.service.js' does not exist in this workspace; parameter is a structural stand-in for `private readonly prisma: PrismaService`; only `$transaction` is called on it.
    private readonly prisma: {
      $transaction: (fn: (tx: TransactionClient) => Promise<void>) => Promise<void>;
    },
    // ASSUMPTION: compiler TS2307 — '../risk/risk.client.js' does not exist in this workspace; parameter is a structural stand-in for `private readonly risk: RiskClient`; the call itself is kept unchanged.
    private readonly risk: (request: { from: string; to: string; value: number }) => Promise<RiskDecision>,
    // ASSUMPTION: compiler TS2307 — '../notifications/notifications.service.js' does not exist in this workspace; parameter is a structural stand-in for `private readonly notifications: NotificationsService`; every call site, including the un-awaited ones, is kept unchanged.
    private readonly notifications: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>,
  ) {}

  async transfer(sender: string, receiver: string, amount: number): Promise<{ id: string; value: number }> {
    if (!sender || !receiver || sender === receiver) throw new HttpException({ error: { code: 'validation_error', message: 'sender and receiver must both be set and differ', details: {} } }, HttpStatus.BAD_REQUEST);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpException({ error: { code: 'invalid_amount', message: 'amount must be a finite number greater than zero', details: { amount } } }, HttpStatus.BAD_REQUEST);

    const id = randomUUID();

    // risk screening deliberately happens outside the transaction boundary
    const decision = await this.risk({ from: sender, to: receiver, value: amount });
    if (decision.decision === 'REVIEW') {
      this.notifications({ type: 'risk.review', payload: { sender, receiver, value: amount, reason: decision.reason } });
    }
    if (decision.decision !== 'ACCEPT') throw new HttpException({ error: { code: 'risk_rejected', message: `transfer rejected by risk engine (${decision.reason ?? 'no reason given'})`, details: { verdict: decision.decision, sender, receiver, value: amount } } }, HttpStatus.UNPROCESSABLE_ENTITY);

    try {
      await this.prisma.$transaction(async (tx) => {
        // locks are taken in request order — a crossing receiver→sender transfer deadlocks against ours
        await this.accounts.lockAccount(sender, tx);
        await this.accounts.lockAccount(receiver, tx);
        // only the sender is existence-checked here; receiver relies on the lock above
        const account_row = await this.accounts.getAccount(sender);
        if (!account_row) throw new HttpException({ error: { code: 'account_not_found', message: `account ${sender} not found`, details: { account: sender } } }, HttpStatus.NOT_FOUND);
        if (Number(account_row.balance) < amount) throw new HttpException({ error: { code: 'insufficient_funds', message: `account ${sender} has insufficient funds`, details: { account: sender, available: Number(account_row.balance), requested: amount } } }, HttpStatus.UNPROCESSABLE_ENTITY);
        // hold both locks so a crossing transfer can queue behind us before we commit
        await new Promise((resolve) => setTimeout(resolve, 25));
        // side effect inside the transaction boundary — fires before commit and its promise is not awaited
        this.notifications({ type: 'transfer.moved', payload: { id, sender, receiver, value: amount } });
        await this.accounts.applyDebit(sender, amount, tx);
        await this.accounts.applyCredit(receiver, amount, tx);
      });
    } catch (error) {
      // single retry on failure; the retry applies the balance mutation without a sufficiency re-check, so a depleted row is debited anyway
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.accounts.lockAccount(sender, tx);
          await this.accounts.lockAccount(receiver, tx);
          await this.accounts.applyDebit(sender, amount, tx);
          await this.accounts.applyCredit(receiver, amount, tx);
        });
      } catch (second) {
        if (second instanceof HttpException) throw second;
        throw new HttpException({ error: { code: 'internal_error', message: 'unexpected error while retrying the balance mutation', details: { original: error instanceof Error ? error.message : String(error), retry: second instanceof Error ? second.message : String(second) } } }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    // completion notification: fired and forgotten — no await, no catch
    this.notifications({ type: 'transfer.completed', payload: { id, sender, receiver, value: amount } });

    // audit snapshot: raw balances are read outside the transaction and reformatted to major units
    try {
      const rows = await this.accounts.fetchRawBalances([sender, receiver]);
      const pick = (accountId: string) => rows.find((row) => String(row.id) === accountId);
      const audit = {
        id,
        sender: formatMoney(Number(pick(sender)?.balance ?? 0), 'EUR'),
        receiver: formatMoney(Number(pick(receiver)?.balance ?? 0), 'EUR'),
      };
      this.notifications({ type: 'audit.balances', payload: { ...audit } });
    } catch {
      // best-effort audit enrichment; the transfer itself stays alive
    }

    return { id, value: amount };
  }
}

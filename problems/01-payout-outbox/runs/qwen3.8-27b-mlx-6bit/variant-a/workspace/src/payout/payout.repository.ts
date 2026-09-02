import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutStatus } from './payout.types.js';

export interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawPayoutRow {
  id: string;
  account_id: string;
  amount: bigint;
  destination_address: string;
  idempotency_key: string;
  status: string;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

function mapRow(raw: RawPayoutRow): PayoutRow {
  return {
    id: raw.id,
    accountId: raw.account_id,
    amount: raw.amount,
    destinationAddress: raw.destination_address,
    idempotencyKey: raw.idempotency_key,
    status: raw.status as PayoutStatus,
    txHash: raw.tx_hash,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

@Injectable()
export class PayoutRepository {
  #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  /**
   * Atomically: SELECT FOR UPDATE on the account row, compute available balance,
   * check sufficiency, INSERT payout + outbox message in one transaction.
   */
  async createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow> {
    return this.#prisma.$transaction(async (tx) => {
      const accounts = await tx.$queryRaw<{ balance: bigint }[]>`
        SELECT balance FROM accounts WHERE id = ${params.accountId}::uuid FOR UPDATE
      `;

      if (accounts.length === 0) {
        throw new Error('Account not found');
      }

      const reserved = await tx.$queryRaw<{ total: bigint | null }[]>`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payouts
        WHERE account_id = ${params.accountId}::uuid
          AND status IN ('created', 'processing', 'sent')
      `;

      const available = accounts[0].balance - (reserved[0]?.total ?? 0n);
      if (available < params.amount) {
        throw new InsufficientFundsError(
          `Available balance ${available.toString()} is less than requested amount ${params.amount.toString()}`,
        );
      }

      const rows = await tx.$queryRaw<RawPayoutRow[]>`
        INSERT INTO payouts (id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at)
        VALUES (gen_random_uuid(), ${params.accountId}::uuid, ${params.amount}, ${params.destinationAddress}, ${params.idempotencyKey}, 'created', NULL, now(), now())
        RETURNING id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
      `;

      const payout = rows[0];

      await tx.$executeRaw`
        INSERT INTO outbox_messages (id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at)
        VALUES (gen_random_uuid(), ${payout.id}::uuid, ${JSON.stringify({ to: params.destinationAddress, amount: params.amount.toString() })}::jsonb, 'pending', 0, NULL, NULL, now(), now())
      `;

      return mapRow(payout);
    });
  }

  /** UPDATE payouts SET status, tx_hash, updated_at WHERE id. Returns updated row or null. */
  async updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      UPDATE payouts
      SET status = ${status}, tx_hash = COALESCE(${txHash ?? null}, tx_hash), updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  /** Single-row read by id. */
  async findById(id: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      SELECT id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
      FROM payouts WHERE id = ${id}::uuid
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  /** Lookup by the unique (account_id, idempotency_key) pair. Returns row or null. */
  async findByAccountIdAndIdempotencyKey(accountId: string, idempotencyKey: string): Promise<PayoutRow | null> {
    const rows = await this.#prisma.$queryRaw<RawPayoutRow[]>`
      SELECT id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
      FROM payouts WHERE account_id = ${accountId}::uuid AND idempotency_key = ${idempotencyKey}
    `;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  /**
   * Atomic ledger post + balance decrement:
   * INSERT ledger_entries (debit=amount, credit=0) + UPDATE accounts SET balance = balance - amount
   * with a guard. In one transaction.
   */
  async confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void> {
    await this.#prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO ledger_entries (id, account_id, debit, credit, reference_type, reference_id, created_at)
        VALUES (gen_random_uuid(), ${accountId}::uuid, ${amount}, 0, 'payout', ${payoutId}::uuid, now())
      `;

      const result = await tx.$queryRaw<{ count: number }[]>`
        UPDATE accounts SET balance = balance - ${amount}
        WHERE id = ${accountId}::uuid AND balance >= ${amount}
        RETURNING 1 AS count
      `;

      if (result.length === 0) {
        throw new Error('Overdraft detected: balance insufficient for ledger confirmation');
      }
    });
  }
}

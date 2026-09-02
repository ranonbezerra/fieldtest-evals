import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';

export interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawOutboxMessageRow {
  id: string;
  payout_id: string;
  payload: { to: string; amount: string };
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(raw: RawOutboxMessageRow): OutboxMessageRow {
  return {
    id: raw.id,
    payoutId: raw.payout_id,
    payload: raw.payload,
    status: raw.status as OutboxMessageRow['status'],
    attempts: raw.attempts,
    nextAttemptAt: raw.next_attempt_at,
    lastError: raw.last_error,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

@Injectable()
export class OutboxRepository {
  #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  /**
   * Claim up to `limit` pending messages using FOR UPDATE SKIP LOCKED,
   * then mark them 'processing'. Returns the claimed rows.
   */
  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.#prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<RawOutboxMessageRow[]>`
        SELECT id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      for (const row of rows) {
        await tx.$executeRaw`
          UPDATE outbox_messages
          SET status = 'processing', updated_at = now()
          WHERE id = ${row.id}::uuid
        `;
      }

      return rows.map(mapRow);
    });
  }

  /** Mark a message done (idempotent). */
  async markDone(messageId: string): Promise<void> {
    await this.#prisma.$executeRaw`
      UPDATE outbox_messages
      SET status = 'done', updated_at = now()
      WHERE id = ${messageId}::uuid
    `;
  }

  /** Increment attempts, set next_attempt_at, set last_error. */
  async recordAttempt(
    messageId: string,
    attempts: number,
    nextAttemptAt: Date | null,
    lastError?: string,
  ): Promise<void> {
    await this.#prisma.$executeRaw`
      UPDATE outbox_messages
      SET attempts = ${attempts},
          next_attempt_at = ${nextAttemptAt},
          last_error = ${lastError ?? null},
          updated_at = now()
      WHERE id = ${messageId}::uuid
    `;
  }
}

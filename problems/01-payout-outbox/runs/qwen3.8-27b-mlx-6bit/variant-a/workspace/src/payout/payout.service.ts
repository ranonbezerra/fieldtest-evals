import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InsufficientFundsError, PayoutRepository } from './payout.repository.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.repository.js';

// The plan pins these contracts on this module; they are defined in the
// repository (the only layer that owns the Prisma row shapes) and surfaced
// here so consumers depend on a single definition.
export type { CreatePayoutInput, PayoutResponse };
export { InsufficientFundsError };

/**
 * Blockchain provider contract (see plan §3). Hosted here so the worker and
 * any other consumer share one definition; wired via DI in the module.
 */
export interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  /**
   * Creates a payout with its funds hold, or returns the existing payout when
   * the idempotency key was already used. A retried request never creates a
   * second payout or reserves funds twice: duplicates are caught on the fast
   * path before any write, and a racer that loses the unique-constraint race
   * is re-fetched instead of inserted.
   */
  async createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    const existing = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return existing;
    }

    try {
      return await this.repository.createPayoutWithHold(input);
    } catch (error) {
      if (!this.isIdempotencyKeyConflict(error)) {
        // InsufficientFundsError and any other failure: pass through so the
        // controller can map it (422 / 500).
        throw error;
      }

      // A concurrent request with the same idempotency key committed first.
      const winner = await this.repository.findPayoutByIdempotencyKey(input.idempotencyKey);
      if (winner !== null) {
        return winner;
      }

      // Practically unreachable: the conflicting row must have committed.
      throw error;
    }
  }

  /**
   * True when `error` is a Prisma unique-constraint violation (P2002) on the
   * payout's idempotency key. `payouts.idempotency_key` is the only unique
   * constraint written in the create path, so a P2002 with no recognisable
   * target is still treated as a duplicate-key race.
   */
  private isIdempotencyKeyConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const meta: Record<string, unknown> | undefined = error.meta;
    const target: unknown[] =
      meta !== undefined && Array.isArray(meta.target) ? (meta.target as unknown[]) : [];

    if (target.length === 0) {
      return true;
    }

    // Prisma reports the model field name, or the mapped column name,
    // depending on version; accept both.
    return target.some((field) => field === 'idempotencyKey' || field === 'idempotency_key');
  }
}

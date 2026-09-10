import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ProjectionRepository, RederiveResult } from './projection.repository';

/** Facts about a new order, as observed inside the write transaction. */
export interface CreatedOrderFacts {
  id: string;
  companyId: string;
  status: OrderStatus;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
}

/** Facts about a status change, as observed inside the write transaction. */
export interface StatusChangeFacts {
  id: string;
  companyId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  amountCents: number;
  occurredAt: Date;
}

/**
 * Synchronous maintenance hooks for the operations projection.
 *
 * Every hook takes the write transaction (`tx`) and writes the projection
 * inside it: the source write and its projection commit together, which is
 * what makes read-your-own-writes hold, and it guarantees that a
 * rolled-back write never leaks into the dashboard.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repo: ProjectionRepository) {}

  async onOrderCreated(tx: Prisma.TransactionClient, facts: CreatedOrderFacts): Promise<void> {
    await this.repo.upsertOpRow(tx, {
      id: facts.id,
      companyId: facts.companyId,
      status: facts.status,
      amountCents: facts.amountCents,
      occurredAt: facts.occurredAt,
      workerName: facts.workerName,
      eventName: facts.eventName,
      createdAt: facts.createdAt,
      updatedAt: facts.occurredAt,
    });
    await this.repo.applyTotalsDelta(tx, {
      companyId: facts.companyId,
      totalDelta: facts.amountCents,
      approvedDelta: 0,
      rejectedDelta: 0,
      countDelta: 1,
    });
  }

  async onOrderStatusChanged(tx: Prisma.TransactionClient, facts: StatusChangeFacts): Promise<void> {
    await this.repo.updateOpRowStatus(tx, facts.id, facts.toStatus, facts.occurredAt);
    const delta = statusDelta(facts.fromStatus, facts.toStatus, facts.amountCents);
    await this.repo.applyTotalsDelta(tx, {
      companyId: facts.companyId,
      totalDelta: 0,
      approvedDelta: delta.approved,
      rejectedDelta: delta.rejected,
      countDelta: 0,
    });
  }

  /**
   * Rebuild the projection for an arbitrary window from the source tables.
   * Idempotent: running it twice over the same window leaves the same result.
   */
  rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    return this.repo.withTransaction((tx) => this.repo.rederiveWindow(tx, from, to), 30_000);
  }
}

function statusDelta(from: OrderStatus, to: OrderStatus, amountCents: number): { approved: number; rejected: number } {
  return {
    approved: (to === 'approved' ? amountCents : 0) - (from === 'approved' ? amountCents : 0),
    rejected: (to === 'rejected' ? amountCents : 0) - (from === 'rejected' ? amountCents : 0),
  };
}

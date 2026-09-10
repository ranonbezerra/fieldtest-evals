import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import { OperationsRepository, type OperationReadInput } from '../operations/operations.repository.js';
import { ProjectionRepository, type RederiveCursor } from './projection.repository.js';

const REDEIVE_CHUNK_SIZE = 500;
const DEFAULT_REPAIR_CRON = '0 * * * *';
const DEFAULT_REPAIR_WINDOW_HOURS = 24;

export interface RederiveResult {
  ordersRederived: number;
  companiesRecomputed: number;
}

@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);
  private repairRunning = false;

  constructor(
    private readonly repository: ProjectionRepository,
    private readonly operationsRepository: OperationsRepository,
    private readonly companyTotalsRepository: CompanyTotalsRepository,
    private readonly transactions: TransactionService,
  ) {}

  // --- Maintenance hooks: invoked by the write services, inside their tx ---

  async onOrderCreated(tx: Prisma.TransactionClient, order: PaymentOrder): Promise<void> {
    const workerName = await this.repository.findWorkerName(tx, order.workerId);
    if (workerName === null) {
      // The write service pre-checks the worker; this only happens if the row
      // vanished between the check and this statement (FK makes it near-impossible).
      throw new AppError('internal_error', `worker ${order.workerId} vanished while projecting order ${order.id}`, {});
    }
    const read: OperationReadInput = {
      id: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      workerName,
      status: order.status,
      amountCents: order.amountCents,
      createdAt: order.createdAt,
      lastEventType: null,
      lastEventAt: null,
    };
    await this.operationsRepository.upsert(tx, read);
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  async onOrderStatusChanged(
    tx: Prisma.TransactionClient,
    order: PaymentOrder,
    previousStatus: OrderStatus,
  ): Promise<void> {
    await this.operationsRepository.setStatus(tx, order.id, order.status);
    // Move the amount between the two status buckets. Each step is one atomic
    // statement, so no other writer can slip between a read and a write.
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, previousStatus, -1, -BigInt(order.amountCents));
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  onEventRecorded(tx: Prisma.TransactionClient, orderId: string, type: string, occurredAt: Date): Promise<void> {
    return this.operationsRepository.setLatestEventIfNewer(tx, orderId, type, occurredAt).then(() => undefined);
  }

  onWorkerRenamed(tx: Prisma.TransactionClient, workerId: string, workerName: string): Promise<void> {
    return this.operationsRepository.renameWorker(tx, workerId, workerName).then(() => undefined);
  }

  // --- Re-derivation / drift repair -----------------------------------------

  /**
   * Rebuilds operation_reads from the source tables for orders created in
   * [from, to), then recomputes the exact company_totals for every affected
   * company from the rebuilt rows. Idempotent: safe to run repeatedly, with
   * overlapping windows, and concurrently with live writes.
   */
  async rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    if (from.getTime() >= to.getTime()) {
      throw AppError.validation("'from' must be earlier than 'to'", {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    let cursor: RederiveCursor | null = null;
    let ordersRederived = 0;
    const affectedCompanies = new Set<string>();

    while (true) {
      const batch = await this.transactions.run(async (tx) => {
        const orders = await this.repository.findOrdersInWindow(tx, from, to, cursor, REDEIVE_CHUNK_SIZE);
        if (orders.length === 0) return orders;

        const workerNames = await this.repository.findWorkerNames(tx, [...new Set(orders.map((o) => o.workerId))]);
        const latestEvents = await this.repository.findLatestEventPerOrder(tx, orders.map((o) => o.id));

        for (const order of orders) {
          const lastEvent = latestEvents.get(order.id);
          const read: OperationReadInput = {
            id: order.id,
            companyId: order.companyId,
            workerId: order.workerId,
            workerName: workerNames.get(order.workerId) ?? '',
            status: order.status,
            amountCents: order.amountCents,
            createdAt: order.createdAt,
            lastEventType: lastEvent?.type ?? null,
            lastEventAt: lastEvent?.occurredAt ?? null,
          };
          await this.operationsRepository.upsert(tx, read);
        }
        return orders;
      });

      if (batch.length === 0) break;
      ordersRederived += batch.length;
      for (const order of batch) affectedCompanies.add(order.companyId);
      const last = batch[batch.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    // Totals are authoritative aggregates over the projection: recompute each
    // affected company's buckets from the rows that are correct now.
    let companiesRecomputed = 0;
    for (const companyId of [...affectedCompanies].sort()) {
      await this.transactions.run(async (tx) => {
        const groups = await this.operationsRepository.sumByStatus(tx, companyId);
        await this.companyTotalsRepository.recompute(tx, companyId, this.totalsFromGroups(groups));
        companiesRecomputed += 1;
      });
    }

    this.logger.log(
      `re-derived ${ordersRederived} operations in [${from.toISOString()}, ${to.toISOString()}); ` +
        `recomputed totals for ${companiesRecomputed} companies`,
    );
    return { ordersRederived, companiesRecomputed };
  }

  /**
   * Scheduled drift-repair job: re-derives a rolling window on a cron. The
   * window overlaps previous runs by design, so anything skipped while a live
   * write was in flight is picked up by the next pass.
   */
  @Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_REPAIR_CRON, { name: 'drift-repair' })
  async scheduledDriftRepair(): Promise<void> {
    if (process.env.DRIFT_REPAIR_ENABLED === 'false') return;
    if (this.repairRunning) {
      this.logger.warn('previous drift-repair run is still in progress; skipping this tick');
      return;
    }
    this.repairRunning = true;
    try {
      const rawHours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_REPAIR_WINDOW_HOURS);
      const windowHours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : DEFAULT_REPAIR_WINDOW_HOURS;
      const to = new Date();
      const from = new Date(to.getTime() - windowHours * 3_600_000);
      await this.rederiveWindow(from, to);
    } catch (error) {
      this.logger.error(`drift-repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.repairRunning = false;
    }
  }

  private totalsFromGroups(
    groups: Array<{ status: OrderStatus; _sum: { amountCents: number | null }; _count: { _all: number } }>,
  ): Record<OrderStatus, { count: number; cents: bigint }> {
    const totals: Record<OrderStatus, { count: number; cents: bigint }> = {
      pending: { count: 0, cents: 0n },
      approved: { count: 0, cents: 0n },
      rejected: { count: 0, cents: 0n },
    };
    for (const group of groups) {
      totals[group.status] = { count: group._count._all, cents: BigInt(group._sum.amountCents ?? 0) };
    }
    return totals;
  }
}

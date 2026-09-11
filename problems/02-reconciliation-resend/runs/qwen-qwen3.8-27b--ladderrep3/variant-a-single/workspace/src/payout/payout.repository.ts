import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Order, OrderStatus, SettlementRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveTxid } from './bank.client.js';

export interface NewOrderInput {
  supplierKey: string;
  /** amount in minor units, integer */
  amountMinor: number;
  /** the date this payment applies to */
  effectiveDate: Date;
}

export interface AttemptPatch {
  status: OrderStatus;
  attempts: number;
  lastAttemptAt: Date;
  lastOutcome: string;
}

/**
 * The contract the service depends on. The repository is the only layer
 * that touches the database; keeping the seam explicit lets the service be
 * tested against an in-memory fake.
 */
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
  findPending(): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  findByTxid(txid: string): Promise<Order | null>;
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]>;
  applyAttempt(id: string, patch: AttemptPatch): Promise<Order>;
  settle(id: string, settledAt: Date): Promise<Order>;
  park(id: string, at: Date, reason: string): Promise<Order>;
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord>;
}

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a pending order. The id is generated here (not by the DB
   * default) so the derived txid can be computed in the same insert.
   */
  create(input: NewOrderInput): Promise<Order> {
    const id = randomUUID();
    return this.prisma.order.create({
      data: {
        id,
        supplierKey: input.supplierKey,
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        txid: deriveTxid({
          id,
          effectiveDate: input.effectiveDate,
          amountMinor: input.amountMinor,
          supplierKey: input.supplierKey,
        }),
      },
    });
  }

  findPending(): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  /**
   * Orders whose last send outcome is unknown, and the bank has had a full
   * publication cycle since the attempt (lastAttemptAt <= asOf).
   */
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'unknown', lastAttemptAt: { lte: asOf } },
      orderBy: { lastAttemptAt: 'asc' },
    });
  }

  applyAttempt(id: string, patch: AttemptPatch): Promise<Order> {
    return this.prisma.order.update({ where: { id }, data: patch });
  }

  settle(id: string, settledAt: Date): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'settled', settledAt },
    });
  }

  park(id: string, at: Date, reason: string): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'parked', parkedAt: at, lastOutcome: `parked:${reason}` },
    });
  }

  /**
   * Record that a statement entry matched an order. Idempotent per txid:
   * re-running reconcile over the same (or an overlapping) window must not
   * duplicate the record.
   */
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord> {
    return this.prisma.settlementRecord.upsert({
      where: { txid: input.txid },
      update: {},
      create: {
        orderId: input.orderId,
        txid: input.txid,
        statementDate: input.statementDate,
        settledAt: input.settledAt,
      },
    });
  }
}

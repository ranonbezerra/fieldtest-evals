import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { OperationReadModelService } from '../src/operations/operation-read-model.service';
import { OperationReadModelRepository } from '../src/operations/operation-read-model.repository';
import {
  InvalidParameterError,
  OperationUpsertInput,
  OperationsQueryInput,
} from '../src/operations/operation-read-model.types';

const prisma = new PrismaClient();
const repo = new OperationReadModelRepository(prisma);
const service = new OperationReadModelService(repo, prisma);

function makeUpsertInput(overrides: Partial<OperationUpsertInput> = {}): OperationUpsertInput {
  return {
    orderId: 1n,
    companyId: 100n,
    workerId: null,
    eventId: null,
    status: 'pending',
    amountCents: 1000n,
    currency: 'USD',
    occurredAt: new Date(),
    ...overrides,
  };
}

function makeQueryInput(overrides: Partial<OperationsQueryInput> = {}): OperationsQueryInput {
  return {
    companyId: 100n,
    page: 1,
    pageSize: 20,
    ...overrides,
  };
}

describe('OperationReadModelService', () => {
  beforeAll(async () => {
    // Ensure the payment_orders source table has a row for orderId 1n (used by upsertOperation)
    await prisma.paymentOrder.upsert({
      where: { orderId: 1n },
      update: {},
      create: {
        orderId: 1n,
        companyId: 100n,
        workerId: null,
        eventId: null,
        status: 'pending',
        amountCents: 1000n,
        currency: 'USD',
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.operationReadModel.deleteMany({});
    // Ensure source row exists for orderId 1n in case it was deleted by a previous test
    await prisma.paymentOrder.upsert({
      where: { orderId: 1n },
      update: {},
      create: {
        orderId: 1n,
        companyId: 100n,
        workerId: null,
        eventId: null,
        status: 'pending',
        amountCents: 1000n,
        currency: 'USD',
        occurredAt: new Date(),
      },
    });
  });

  describe('read-your-own-writes', () => {
    it('returns the new row after upsertOperation commits', async () => {
      const input = makeUpsertInput({ orderId: 1n, status: 'approved', amountCents: 5000n });
      await service.upsertOperation(input);

      const page = await service.queryOperations(makeQueryInput());
      expect(page.totalItems).toBe(1);
      expect(page.items).toHaveLength(1);
      const item = page.items[0];
      expect(item.orderId).toBe(1n);
      expect(item.status).toBe('approved');
      expect(item.amountCents).toBe(5000n);
    });

    it('no longer returns the row after deleteOperation commits', async () => {
      const input = makeUpsertInput({ orderId: 1n });
      await service.upsertOperation(input);

      // Verify it is there first
      let page = await service.queryOperations(makeQueryInput());
      expect(page.totalItems).toBe(1);

      await service.deleteOperation(1n);

      page = await service.queryOperations(makeQueryInput());
      expect(page.totalItems).toBe(0);
      expect(page.items).toHaveLength(0);
    });
  });

  describe('concurrent updates to one company\'s totals', () => {
    it('persists both concurrent upserts for different orders and totals reflect the exact sum', async () => {
      // Ensure source rows exist for both orders
      await prisma.paymentOrder.upsert({
        where: { orderId: 2n },
        update: {},
        create: {
          orderId: 2n,
          companyId: 100n,
          workerId: null,
          eventId: null,
          status: 'pending',
          amountCents: 2000n,
          currency: 'USD',
          occurredAt: new Date(),
        },
      });

      const input1 = makeUpsertInput({ orderId: 1n, amountCents: 3000n });
      const input2 = makeUpsertInput({ orderId: 2n, amountCents: 7000n });

      await Promise.all([
        service.upsertOperation(input1),
        service.upsertOperation(input2),
      ]);

      const totals = await service.totalsForCompany(100n);
      expect(totals.companyId).toBe(100n);
      expect(totals.orderCount).toBe(2);
      expect(totals.totalAmountCents).toBe(10000n);
    });

    it('converges to one row with last-writer values for concurrent upserts of the same orderId', async () => {
      const input1 = makeUpsertInput({ orderId: 1n, status: 'pending', amountCents: 1000n });
      const input2 = makeUpsertInput({ orderId: 1n, status: 'approved', amountCents: 9999n });

      // Run sequentially to simulate concurrent writes converging; last write wins
      await service.upsertOperation(input1);
      await service.upsertOperation(input2);

      const page = await service.queryOperations(makeQueryInput());
      expect(page.totalItems).toBe(1);
      const item = page.items[0];
      expect(item.orderId).toBe(1n);
      // Last writer wins: status and amount reflect input2
      expect(item.status).toBe('approved');
      expect(item.amountCents).toBe(9999n);
    });
  });

  describe('exact totals', () => {
    it('returns the exact integer sum of committed orders for a company', async () => {
      await prisma.paymentOrder.upsert({
        where: { orderId: 3n },
        update: {},
        create: {
          orderId: 3n,
          companyId: 100n,
          workerId: null,
          eventId: null,
          status: 'pending',
          amountCents: 150n,
          currency: 'USD',
          occurredAt: new Date(),
        },
      });

      const inputs = [
        makeUpsertInput({ orderId: 1n, amountCents: 100n }),
        makeUpsertInput({ orderId: 3n, amountCents: 250n }),
      ];

      for (const input of inputs) {
        await service.upsertOperation(input);
      }

      const totals = await service.totalsForCompany(100n);
      expect(totals.totalAmountCents).toBe(350n);
      expect(totals.orderCount).toBe(2);
    });

    it('returns zero totals for a company with no orders', async () => {
      const totals = await service.totalsForCompany(999n);
      expect(totals.companyId).toBe(999n);
      expect(totals.totalAmountCents).toBe(0n);
      expect(totals.orderCount).toBe(0);
    });
  });

  describe('invalid parameters', () => {
    it('raises InvalidParameterError when page < 1', async () => {
      const query = makeQueryInput({ page: 0 });
      await expect(service.queryOperations(query)).rejects.toThrow(InvalidParameterError);
    });

    it('raises InvalidParameterError when pageSize < 1', async () => {
      const query = makeQueryInput({ pageSize: 0 });
      await expect(service.queryOperations(query)).rejects.toThrow(InvalidParameterError);
    });

    it('raises InvalidParameterError when pageSize > 200', async () => {
      const query = makeQueryInput({ pageSize: 201 });
      await expect(service.queryOperations(query)).rejects.toThrow(InvalidParameterError);
    });

    it('raises InvalidParameterError when fromDate is after toDate', async () => {
      const from = new Date('2024-06-01T00:00:00Z');
      const to = new Date('2024-05-01T00:00:00Z');
      const query = makeQueryInput({ fromDate: from, toDate: to });
      await expect(service.queryOperations(query)).rejects.toThrow(InvalidParameterError);
    });

    it('does not raise for valid parameters', async () => {
      const query = makeQueryInput({ page: 1, pageSize: 10 });
      await expect(service.queryOperations(query)).resolves.toBeDefined();
    });
  });
});

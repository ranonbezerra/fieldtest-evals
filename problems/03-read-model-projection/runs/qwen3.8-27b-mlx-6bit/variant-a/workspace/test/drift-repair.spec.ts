import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { DriftRepairProcessor } from '../src/operations/drift-repair.processor';
import { OperationReadModelService } from '../src/operations/operation-read-model.service';
import { OperationReadModelRepository } from '../src/operations/operation-read-model.repository';
import { DateWindow, OperationUpsertInput } from '../src/operations/operation-read-model.types';

// ASSUMPTION: the test environment does not provide a real Postgres instance or
// NestJS DI container; the processor and service are instantiated directly with
// a shared PrismaClient and a stub ConfigService so that repairDrift can be
// exercised against the actual database.

class StubConfigService {
  get(key: string): unknown {
    return undefined;
  }
}

describe('drift repair', () => {
  let prisma: PrismaClient;
  let repo: OperationReadModelRepository;
  let service: OperationReadModelService;
  let processor: DriftRepairProcessor;

  const companyId = 1001n;
  const baseTime = new Date('2025-01-15T12:00:00.000Z');

  function makeInput(
    orderId: bigint,
    overrides: Partial<OperationUpsertInput> = {},
  ): OperationUpsertInput {
    return {
      orderId,
      companyId,
      workerId: 50n,
      eventId: 75n,
      status: 'approved',
      amountCents: 2500n,
      currency: 'USD',
      occurredAt: baseTime,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = new PrismaClient();
    repo = new OperationReadModelRepository(prisma);
    service = new OperationReadModelService(repo, prisma);
    processor = new DriftRepairProcessor(service, new StubConfigService());

    await prisma.operationReadModel.deleteMany();
    await prisma.paymentOrder.deleteMany();
  });

  async function seedSourceOrder(
    orderId: bigint,
    input: OperationUpsertInput,
  ): Promise<void> {
    await prisma.paymentOrder.create({
      data: {
        orderId,
        companyId: input.companyId,
        workerId: input.workerId,
        eventId: input.eventId,
        status: input.status,
        amountCents: input.amountCents,
        currency: input.currency,
        occurredAt: input.occurredAt,
      },
    });
  }

  it('recovers a divergent projection row to match the source', async () => {
    const orderId = 9001n;
    const input = makeInput(orderId);
    await seedSourceOrder(orderId, input);
    await service.upsertOperation(input);

    // Corrupt the projection row so it diverges from the source.
    await prisma.operationReadModel.update({
      where: { orderId },
      data: { status: 'rejected', amountCents: 999n },
    });

    const window: DateWindow = {
      from: new Date(baseTime.getTime() - 60_000),
      to: new Date(baseTime.getTime() + 60_000),
    };
    const repaired = await service.rederiveWindow(window);
    expect(repaired).toBeGreaterThan(0);

    const restored = await prisma.operationReadModel.findUnique({
      where: { orderId },
    });
    expect(restored).not.toBeNull();
    expect(restored!.status).toBe('approved');
    expect(restored!.amountCents).toBe(2500n);
    expect(restored!.currency).toBe('USD');
  });

  it('is idempotent: re-deriving the same window twice yields identical rows', async () => {
    const orderIdA = 9101n;
    const orderIdB = 9102n;
    const inputA = makeInput(orderIdA, { amountCents: 1000n });
    const inputB = makeInput(orderIdB, { amountCents: 3000n });
    await seedSourceOrder(orderIdA, inputA);
    await seedSourceOrder(orderIdB, inputB);
    await service.upsertOperation(inputA);
    await service.upsertOperation(inputB);

    const window: DateWindow = {
      from: new Date(baseTime.getTime() - 60_000),
      to: new Date(baseTime.getTime() + 60_000),
    };

    const first = await service.rederiveWindow(window);
    const afterFirst = await prisma.operationReadModel.findMany({
      where: { occurredAt: { gte: window.from, lt: window.to } },
      orderBy: { orderId: 'asc' },
    });

    const second = await service.rederiveWindow(window);
    const afterSecond = await prisma.operationReadModel.findMany({
      where: { occurredAt: { gte: window.from, lt: window.to } },
      orderBy: { orderId: 'asc' },
    });

    expect(first).toBe(2);
    expect(second).toBe(2);
    expect(afterSecond.length).toBe(afterFirst.length);

    const key = (r: { orderId: bigint; status: string; amountCents: bigint; currency: string }) =>
      `${r.orderId}:${r.status}:${r.amountCents}:${r.currency}`;
    expect(afterSecond.map(key)).toEqual(afterFirst.map(key));
  });

  it('leaves rows outside the re-derivation window untouched', async () => {
    const insideId = 9201n;
    const outsideId = 9202n;
    const insideInput = makeInput(insideId, { amountCents: 1500n });
    const outsideInput = makeInput(outsideId, {
      amountCents: 4000n,
      occurredAt: new Date('2025-03-01T00:00:00.000Z'),
    });
    await seedSourceOrder(insideId, insideInput);
    await seedSourceOrder(outsideId, outsideInput);
    await service.upsertOperation(insideInput);
    await service.upsertOperation(outsideInput);

    // Corrupt the row that is inside the window.
    await prisma.operationReadModel.update({
      where: { orderId: insideId },
      data: { status: 'corrupted', amountCents: 1n },
    });

    const window: DateWindow = {
      from: new Date(baseTime.getTime() - 60_000),
      to: new Date(baseTime.getTime() + 60_000),
    };
    await service.rederiveWindow(window);

    const inside = await prisma.operationReadModel.findUnique({
      where: { orderId: insideId },
    });
    const outside = await prisma.operationReadModel.findUnique({
      where: { orderId: outsideId },
    });

    expect(inside!.status).toBe('approved');
    expect(inside!.amountCents).toBe(1500n);
    // The outside row was never re-derived, so it keeps its original values.
    expect(outside!.amountCents).toBe(4000n);
  });

  it('repairDrift repairs a sliding window and restores divergence', async () => {
    const orderId = 9301n;
    // Place the order well behind the default lag (1 hour) so it falls inside
    // the sliding window [now - 1h, now - 5min].
    const occurredAt = new Date(Date.now() - 30 * 60 * 1000);
    const input = makeInput(orderId, { occurredAt });
    await seedSourceOrder(orderId, input);
    await service.upsertOperation(input);

    await prisma.operationReadModel.update({
      where: { orderId },
      data: { status: 'drifted', amountCents: 123n },
    });

    await processor.repairDrift();

    const restored = await prisma.operationReadModel.findUnique({
      where: { orderId },
    });
    expect(restored).not.toBeNull();
    expect(restored!.status).toBe('approved');
    expect(restored!.amountCents).toBe(2500n);
  });

  it('repairDrift is idempotent across repeated ticks', async () => {
    const orderId = 9401n;
    const occurredAt = new Date(Date.now() - 30 * 60 * 1000);
    const input = makeInput(orderId, { occurredAt });
    await seedSourceOrder(orderId, input);
    await service.upsertOperation(input);

    const first = await processor.repairDrift();
    const afterFirst = await prisma.operationReadModel.findUnique({
      where: { orderId },
    });

    const second = await processor.repairDrift();
    const afterSecond = await prisma.operationReadModel.findUnique({
      where: { orderId },
    });

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(afterSecond!.status).toBe(afterFirst!.status);
    expect(afterSecond!.amountCents).toBe(afterFirst!.amountCents);
  });
});

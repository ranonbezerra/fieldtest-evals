import { PrismaClient } from '@prisma/client';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient();
}

export interface TestFixtures {
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventName: string;
}

export async function seedFixtures(prisma: PrismaClient): Promise<TestFixtures> {
  const company = await prisma.company.create({
    data: { name: `Test Company ${Math.random().toString(36).slice(2)}` },
  });
  const worker = await prisma.worker.create({ data: { fullName: 'Ada Worker' } });
  const event = await prisma.event.create({ data: { companyId: company.id, name: 'Harvest Fair' } });
  return {
    companyId: company.id,
    workerId: worker.id,
    workerName: worker.fullName,
    eventId: event.id,
    eventName: event.name,
  };
}

/** Removes everything a fixture created, in both source and projection. */
export async function cleanupFixtures(prisma: PrismaClient, fx: TestFixtures): Promise<void> {
  const orderIds = (
    await prisma.paymentOrder.findMany({ where: { companyId: fx.companyId }, select: { id: true } })
  ).map((order) => order.id);
  await prisma.operationReadModel.deleteMany({ where: { paymentOrderId: { in: orderIds } } });
  await prisma.companyFinancialTotals.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.paymentOrder.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.event.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.worker.deleteMany({ where: { id: fx.workerId } });
  await prisma.company.deleteMany({ where: { id: fx.companyId } });
}

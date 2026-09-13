import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({ log: [] });

beforeAll(async () => {
  await prisma.$connect();
  global.__prisma = prisma;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean all projection and source tables between tests.
  await prisma.orderDashboard.deleteMany();
  await prisma.companyFinancialTotals.deleteMany();
  await prisma.event.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.company.deleteMany();
});

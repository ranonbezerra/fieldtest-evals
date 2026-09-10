import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

export interface DashboardItem {
  id: string;
  companyId: string;
  workerId: string | null;
  workerName: string | null;
  eventId: string | null;
  eventTitle: string | null;
  eventVenue: string | null;
  eventStartsAt: string | null;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatusTotal {
  amountCents: number;
  count: number;
}

export interface DashboardBody {
  items: DashboardItem[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  totals: Record<string, StatusTotal>;
}

export interface CompanyFixture {
  companyId: string;
  workerId: string;
  eventId: string;
  workerName: string;
  eventTitle: string;
}

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

export async function withClient<T>(fn: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = new PrismaClient();
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

export async function createCompanyFixture(client: PrismaClient): Promise<CompanyFixture> {
  const companyId = randomUUID();
  const workerId = randomUUID();
  const eventId = randomUUID();
  await client.company.create({ data: { id: companyId, name: `Company ${companyId.slice(0, 8)}` } });
  await client.worker.create({ data: { id: workerId, companyId, name: 'Worker One' } });
  await client.event.create({
    data: { id: eventId, companyId, title: 'Lunar Concert', venue: 'Grand Hall', startsAt: new Date('2025-06-01T18:00:00.000Z') },
  });
  return { companyId, workerId, eventId, workerName: 'Worker One', eventTitle: 'Lunar Concert' };
}

export async function deleteCompanyFixture(client: PrismaClient, fixture: CompanyFixture): Promise<void> {
  await client.paymentOrder.deleteMany({ where: { companyId: fixture.companyId } });
  await client.operationView.deleteMany({ where: { companyId: fixture.companyId } });
  await client.companyOperationTotals.deleteMany({ where: { companyId: fixture.companyId } });
  await client.worker.deleteMany({ where: { id: fixture.workerId } });
  await client.event.deleteMany({ where: { id: fixture.eventId } });
  await client.company.deleteMany({ where: { id: fixture.companyId } });
}

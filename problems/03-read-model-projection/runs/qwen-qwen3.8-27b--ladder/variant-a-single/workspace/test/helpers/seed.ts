import { Company, Event, PrismaClient, Worker } from '@prisma/client';

export interface Seed {
  company: Company;
  worker: Worker;
  event: Event;
}

export async function seedLookup(prisma: PrismaClient, companyName = 'Acme'): Promise<Seed> {
  const company = await prisma.company.create({ data: { name: companyName } });
  const worker = await prisma.worker.create({ data: { name: 'Wendy' } });
  const event = await prisma.event.create({ data: { title: 'Launch' } });
  return { company, worker, event };
}

import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { AnchorsService } from '../src/anchors/anchors.service.js';
import {
  ConfirmationWorkerService,
  RecoverySweepService,
} from '../src/anchors/anchors.worker.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../src/content/document-content-provider.js';

export interface Harness {
  prisma: PrismaClient;
  chain: FakeChainClient;
  content: InMemoryDocumentContentProvider;
  repo: AnchorsRepository;
  service: AnchorsService;
  confirmation: ConfirmationWorkerService;
  sweep: RecoverySweepService;
}

/**
 * Service-level test harness: the real services, the real Prisma/Postgres, a
 * scripted fake chain, and an in-memory content provider. Every test uses a
 * fresh document id, so tests are isolated without deleting rows.
 *
 * Requires DATABASE_URL pointing at a migrated PostgreSQL database
 * (`pnpm db:migrate`) and the generated Prisma client (`pnpm prisma:generate`).
 */
export function createHarness(): Harness {
  const prisma = new PrismaClient();
  const chain = new FakeChainClient();
  const content = new InMemoryDocumentContentProvider();
  const repo = new AnchorsRepository(prisma);
  const service = new AnchorsService(content, chain, repo);
  const confirmation = new ConfirmationWorkerService(repo, chain);
  const sweep = new RecoverySweepService(repo, chain);
  return { prisma, chain, content, repo, service, confirmation, sweep };
}

export async function disposeHarness(harness: Harness): Promise<void> {
  await harness.prisma.$disconnect();
}

/**
 * A fixed sample report: nested objects whose keys are not in sorted order,
 * decimals, booleans, arrays, and UTF-8 text — so canonicalization actually
 * has work to do.
 */
export const SAMPLE_CONTENT = {
  reportType: 'clinical-summary',
  subject: 'Patient 000-1234',
  vitals: { heartRate: 72, spo2: 0.98, notes: 'stable, no intervention required' },
  sections: ['admission', 'course', 'discharge'],
  metadata: { author: 'dr. ávila', unit: 'ICU-3', reviewed: true },
};

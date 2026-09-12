/**
 * Crash-test child process. Spawned by test/anchor.spec.ts:
 *
 *   node --import tsx test/fixtures/anchor-crash-child.ts <chain-file> <documentId> <version> <contentJson>
 *
 * Anchors a document against a chain fake that kills the process right after
 * the tx is recorded on chain — i.e. exactly between the broadcast and the
 * post-broadcast persistence. Any exit code other than 0 is expected;
 * completing the anchor normally would mean the simulated crash failed.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { AnchorRepository } from '../../src/anchor/anchor.repository.js';
import { AnchorService } from '../../src/anchor/anchor.service.js';
import { FakeChainClient } from '../fakes/chain-client.fake.js';

const [, , chainFile, documentId, versionRaw, contentJson] = process.argv;

if (chainFile === undefined || documentId === undefined || versionRaw === undefined || contentJson === undefined) {
  console.error('usage: anchor-crash-child <chain-file> <documentId> <version> <contentJson>');
  process.exit(2);
}

const version = Number(versionRaw);
if (!Number.isInteger(version)) {
  console.error('version must be an integer');
  process.exit(2);
}
const content = JSON.parse(contentJson) as Record<string, unknown>;

const prisma = new PrismaClient();
try {
  const chain = new FakeChainClient({ writeChainStateTo: chainFile, crashAfterBroadcast: true });
  const service = new AnchorService(new AnchorRepository(), chain);
  await service.anchor(documentId, version, content);
  // Unreachable: the fake kills the process after the broadcast is recorded.
  console.error('FATAL: simulated crash did not happen; the test is broken');
  process.exit(3);
} catch (err) {
  console.error('FATAL: crash child failed before reaching the crash point', err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}

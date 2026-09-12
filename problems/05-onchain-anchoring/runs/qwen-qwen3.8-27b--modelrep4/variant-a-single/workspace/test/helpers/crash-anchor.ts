/**
 * Forked by test/anchor.crash.spec.ts. Anchors one (document, version)
 * against the real database with a fake chain that SIGKILLs the process
 * inside broadcast() — the exact window a "broadcast first, persist later"
 * design loses the anchor in. The intent row must already be durable when
 * this process dies.
 */
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { AnchorService } from '../../src/anchor/anchor.service.js';
import { AnchorRepository } from '../../src/anchor/anchor.repository.js';
import { FileChainClient } from '../../src/anchor/file-chain-client.js';
import { StaticContentSource } from './static-content-source.js';

const [documentId, version, chainStatePath, contentJson] = process.argv.slice(2);
if (!documentId || !version || !chainStatePath || !contentJson) {
  console.error('usage: crash-anchor <documentId> <version> <chainStatePath> <contentJson>');
  process.exit(2);
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  const service = new AnchorService(
    new AnchorRepository(prisma),
    new FileChainClient(chainStatePath, { crashAfterBroadcast: true }),
    new StaticContentSource(JSON.parse(contentJson)),
  );
  await service.anchorDocument(documentId, version);
  console.error('FATAL: the simulated crash inside broadcast() did not happen');
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('FATAL: anchorDocument failed before the simulated crash:', err);
  process.exit(1);
});

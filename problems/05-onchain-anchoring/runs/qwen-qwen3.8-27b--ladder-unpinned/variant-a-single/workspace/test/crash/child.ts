import { PrismaClient } from '@prisma/client';
import { AnchorsRepository } from '../../src/anchors/anchors.repository.js';
import { AnchorsService } from '../../src/anchors/anchors.service.js';
import { FakeChainClient } from '../../src/chain/fake-chain-client.js';
import { InMemoryDocumentContentProvider } from '../../src/content/document-content-provider.js';

/**
 * Spawned by test/recovery.spec.ts to prove crash recovery with a real process
 * crash.
 *
 * It runs the production anchorDocument() against a file-backed fake chain.
 * The fake kills this process (exit code 9) the instant the chain ACCEPTS the
 * transaction — i.e. after the write-ahead intent is committed and after the
 * broadcast, but before the status update; the point where a naive design
 * would persist the anchor and has nothing. The parent then restarts and
 * recovers, and asserts exactly one anchor and one transaction identity.
 */
const [stateFile, documentId, versionRaw, confirmBeforeCrashRaw] = process.argv.slice(2);
if (!stateFile || !documentId || !versionRaw) {
  console.error('usage: child.ts <stateFile> <documentId> <version> [confirmBeforeCrash=0|1]');
  process.exit(2);
}

const version = Number(versionRaw);
const confirmBeforeCrash = confirmBeforeCrashRaw === '1';

const prisma = new PrismaClient();
const chain = new FakeChainClient({ stateFile });
chain.onBroadcast = (txId) => {
  if (confirmBeforeCrash) chain.confirmTx(txId, 4242n);
  // The scripted crash: the chain has the transaction; our status write is lost.
  process.exit(9);
};

const content = new InMemoryDocumentContentProvider();
content.publish(documentId, version, {
  reportType: 'clinical-summary',
  anchoredIn: 'crash-recovery-test',
});

const repository = new AnchorsRepository(prisma);
const service = new AnchorsService(content, chain, repository);

try {
  await service.anchorDocument(documentId, version);
} catch {
  // The scripted exit(9) fires inside the broadcast hook; reaching here means
  // something else went wrong, and is reported via the non-zero exit code.
  throw new Error('anchorDocument returned before the scripted crash');
}
await prisma.$disconnect();

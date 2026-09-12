import { afterAll, describe, expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorRepository } from '../src/anchor/anchor.repository.js';
import { FileChainClient } from '../src/anchor/file-chain-client.js';
import { StaticContentSource } from './helpers/static-content-source.js';

// Proves the ordering requirement end-to-end: a process that dies between
// broadcast and the (wrong) late persist a naive "broadcast first, persist
// later" design would do must leave exactly one durable anchor row, and the
// recovery sweep must reconcile it without creating a second tx.
//
// Requires a Postgres test database with migrations applied
// (pnpm prisma migrate deploy). Skipped when DATABASE_URL is not set.
describe.runIf(Boolean(process.env.DATABASE_URL))('crash recovery against a real database', () => {
  const prisma = new PrismaService();
  let workDir: string | undefined;
  let anchoredDocumentId: string | undefined;

  afterAll(async () => {
    if (anchoredDocumentId) {
      await prisma.documentAnchor
        .deleteMany({ where: { documentId: anchoredDocumentId } })
        .catch(() => undefined);
    }
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('dies between broadcast and state update, then recovers to a single confirmed anchor', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'anchor-crash-'));
    const chainStatePath = join(workDir, 'chain-state.json');
    const documentId = `crash-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const version = '1';
    const content = {
      documentType: 'clinical-report',
      patient: 'anon-001',
      findings: [{ code: 'Q00.9' }, { code: 'Z10' }],
      issuedBy: 'dr-01',
    };
    anchoredDocumentId = documentId;

    // Stage 1: fork a child that anchors, with a fake chain that SIGKILLs the
    // process inside broadcast() — after the chain accepted the tx, before
    // the service advances the persisted state.
    const child = fork(
      fileURLToPath(new URL('./helpers/crash-anchor.ts', import.meta.url)),
      [documentId, version, chainStatePath, JSON.stringify(content)],
      { execArg: ['--import', 'tsx'], env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (exit.signal !== 'SIGKILL') {
      throw new Error(
        `expected the child to die via SIGKILL inside broadcast(), got code=${exit.code} signal=${exit.signal}\n--- child stderr ---\n${stderr}`,
      );
    }

    // The chain accepted exactly one tx before the crash.
    const chainAfterCrash = JSON.parse(readFileSync(chainStatePath, 'utf8')) as {
      txs: { txId: string; blockNumber: number }[];
    };
    expect(chainAfterCrash.txs).toHaveLength(1);
    const { txId, blockNumber } = chainAfterCrash.txs[0];

    // The intent row is durable in Postgres, persisted BEFORE the broadcast:
    // a naive "broadcast then persist" design would have none at all here.
    const crashedRow = await prisma.documentAnchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    expect(crashedRow).not.toBeNull();
    expect(crashedRow!.txId).toBe(txId);
    expect(crashedRow!.state).toBe('PENDING_BROADCAST');

    // Stage 2: the recovery sweep queries the chain first and finds the
    // receipt — it confirms without re-broadcasting.
    const service = new AnchorService(
      new AnchorRepository(prisma),
      new FileChainClient(chainStatePath),
      new StaticContentSource(content),
    );
    const recovery = await service.recoverStuckAnchors();
    expect(recovery).toMatchObject({ confirmed: 1, reBroadcast: 0 });

    const recovered = await prisma.documentAnchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    expect(recovered!.state).toBe('CONFIRMED');
    expect(recovered!.txId).toBe(txId); // the same on-chain identity, not a new tx
    expect(recovered!.blockNumber).toBe(blockNumber);

    // The chain still holds exactly one tx.
    const chainAfterRecovery = JSON.parse(readFileSync(chainStatePath, 'utf8')) as {
      txs: { txId: string }[];
    };
    expect(chainAfterRecovery.txs).toHaveLength(1);
    expect(chainAfterRecovery.txs[0].txId).toBe(txId);

    // Stage 3: re-anchoring the same (document, version) is a no-op — the
    // schema-level unique constraint keeps it at exactly one anchor.
    const again = await service.anchorDocument(documentId, version);
    expect(again.id).toBe(crashedRow!.id);
    expect(again.state).toBe('CONFIRMED');
    expect(await prisma.documentAnchor.count({ where: { documentId_version: { documentId, version } } })).toBe(1);
    const chainFinal = JSON.parse(readFileSync(chainStatePath, 'utf8')) as { txs: { txId: string }[] };
    expect(chainFinal.txs).toHaveLength(1);

    // verify returns the anchoring proof.
    const proof = await service.verify(documentId, version, content);
    expect(proof).toMatchObject({ status: 'anchored', txId, blockNumber });
  }, 60000);
});

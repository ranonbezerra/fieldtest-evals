import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { canonicalHashOf } from '../src/anchors/anchors.service.js';
import {
  ConfirmationWorkerService,
  RecoverySweepService,
} from '../src/anchors/anchors.worker.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { createHarness, disposeHarness, type Harness } from './harness.js';

// The crash tests sweep rows created milliseconds ago.
process.env.RECOVERY_MIN_AGE_MS = '0';

const childScript = fileURLToPath(new URL('./crash/child.ts', import.meta.url));

describe('recovery sweep and confirmation worker', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, { reportType: 'clinical-summary' });
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  it('confirms from the receipt when the broadcast timed out but landed — no re-broadcast', async () => {
    h.chain.scriptBroadcast('timeout');
    const record = await h.service.anchorDocument(documentId, 1);
    expect(record.status).toBe('OUTCOME_UNKNOWN');

    h.chain.confirmTx(record.txId, 77n);
    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('CONFIRMED');
    expect(row!.blockNumber).toBe(77n);
    expect(row!.confirmedAt).toBeInstanceOf(Date);
    // The receipt settled it: the sweep must not re-broadcast.
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('re-broadcasts the SAME signed tx when the chain has no trace, ending with one anchor and one tx identity', async () => {
    h.chain.scriptBroadcast('timeout-not-landed');
    const record = await h.service.anchorDocument(documentId, 1);
    expect(record.status).toBe('OUTCOME_UNKNOWN');
    expect(h.chain.broadcastLog).toHaveLength(0); // the chain truly has no trace

    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(row!.broadcastAttempts).toBe(2);
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
    expect(h.chain.broadcastLog[0]!.signedTx).toBe(record.signedTx); // the same one, not a new one

    h.chain.confirmTx(record.txId, 88n);
    await h.confirmation.pollOnce();

    expect((await h.repo.findByDocumentVersion(documentId, 1))!.status).toBe('CONFIRMED');
    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(1);
    expect(new Set(h.chain.broadcastLog.map((entry) => entry.txId)).size).toBe(1);
  });

  it('broadcasts a stale PREPARED anchor (crashed before the broadcast call) without a second identity', async () => {
    const content = { reportType: 'clinical-summary' };
    const contentHash = canonicalHashOf(content);
    const payload = { kind: 'report_anchor', documentId, version: 1, contentHash } as const;
    const prepared = await h.chain.prepare(payload);
    await h.repo.createIntent({
      documentId,
      version: 1,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
      payload,
    });

    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('BROADCAST_SENT');
    expect(h.chain.broadcastLog[0]!.signedTx).toBe(prepared.signedTx);
    expect(h.chain.broadcastCountFor(prepared.txId)).toBe(1);
  });

  it('marks FAILED when the sweep finds a failed receipt, without re-broadcasting', async () => {
    h.chain.scriptBroadcast('timeout');
    const record = await h.service.anchorDocument(documentId, 1);

    h.chain.failTx(record.txId, 'reverted: anchor slot busy', 99n);
    await h.sweep.sweepOnce();

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('FAILED');
    expect(row!.failureReason).toBe('reverted: anchor slot busy');
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('crash between broadcast and status update: the restarted app recovers from the chain — one anchor, one tx identity', async () => {
    const stateFile = join(tmpdir(), `fake-chain-${randomUUID()}.json`);
    const crashDocId = `doc-${randomUUID()}`;
    try {
      const { code, stderr } = await runCrashChild(stateFile, crashDocId, false);
      expect(code, `child should die with the scripted exit code 9; stderr: ${stderr}`).toBe(9);

      // Restart: fresh services, the same (file-backed) chain.
      const chain = new FakeChainClient({ stateFile });
      const repo = new AnchorsRepository(h.prisma);
      const sweep = new RecoverySweepService(repo, chain);
      const confirmation = new ConfirmationWorkerService(repo, chain);

      // The write-ahead intent survived the crash: the row exists with the tx
      // identity, still PREPARED because the crash ate the status update.
      const rowAtRestart = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowAtRestart, 'the anchor intent must have been committed before the crash').not.toBeNull();
      expect(rowAtRestart!.status).toBe('PREPARED');
      const { txId, signedTx } = rowAtRestart!;

      // The chain accepted the transaction before the crash: one broadcast, no receipt.
      expect(chain.broadcastCountFor(txId)).toBe(1);
      expect(chain.broadcastLog[0]!.signedTx).toBe(signedTx);

      // Recovery asks the chain first: no receipt yet, so it re-broadcasts the same signed tx.
      await sweep.sweepOnce();
      const rowAfterSweep = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowAfterSweep!.status).toBe('BROADCAST_SENT');
      expect(rowAfterSweep!.txId).toBe(txId); // the identity was never re-prepared
      expect(chain.broadcastCountFor(txId)).toBe(2);
      expect(chain.broadcastLog[1]!.signedTx).toBe(signedTx); // the same signed tx, not a new one

      // The transaction lands; the confirmation worker confirms from the receipt.
      chain.confirmTx(txId, 555n);
      await confirmation.pollOnce();
      const rowFinal = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowFinal!.status).toBe('CONFIRMED');
      expect(rowFinal!.blockNumber).toBe(555n);

      // Exactly one anchor and exactly one transaction identity.
      expect(await repo.countByDocumentVersion(crashDocId, 1)).toBe(1);
      expect(new Set(chain.broadcastLog.map((entry) => entry.txId)).size).toBe(1);
    } finally {
      rmSync(stateFile, { force: true });
    }
  });

  it('crash after the chain already confirmed: the sweep confirms from the receipt without re-broadcasting', async () => {
    const stateFile = join(tmpdir(), `fake-chain-${randomUUID()}.json`);
    const crashDocId = `doc-${randomUUID()}`;
    try {
      const { code, stderr } = await runCrashChild(stateFile, crashDocId, true);
      expect(code, `child should die with the scripted exit code 9; stderr: ${stderr}`).toBe(9);

      const chain = new FakeChainClient({ stateFile });
      const repo = new AnchorsRepository(h.prisma);
      const sweep = new RecoverySweepService(repo, chain);

      const row = await repo.findByDocumentVersion(crashDocId, 1);
      expect(row).not.toBeNull();
      expect(row!.status).toBe('PREPARED');

      await sweep.sweepOnce();

      const rowFinal = await repo.findByDocumentVersion(crashDocId, 1);
      expect(rowFinal!.status).toBe('CONFIRMED');
      expect(rowFinal!.blockNumber).toBe(4242n);
      expect(chain.broadcastCountFor(row!.txId)).toBe(1); // no re-broadcast: the receipt settled it
      expect(await repo.countByDocumentVersion(crashDocId, 1)).toBe(1);
    } finally {
      rmSync(stateFile, { force: true });
    }
  });
});

function runCrashChild(
  stateFile: string,
  documentId: string,
  confirmBeforeCrash: boolean,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', childScript, stateFile, documentId, '1', confirmBeforeCrash ? '1' : '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (code) => {
      clearTimeout(watchdog);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

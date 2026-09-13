import { Inject, Injectable, HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ChainClient } from '../chain/chain-client.interface.js';
import { AnchorRepository } from './anchor.repository.js';
import type {
  AnchorRecord,
  AnchorProof,
  ContentMismatch,
  CreateAnchorInput,
  VerifyResult,
} from './anchor.types.js';

// Canonicalisation rules (auditor-compatible):
// 1. Recursively sort all object keys alphabetically.
// 2. Arrays preserve order; elements are canonicalised recursively.
// 3. Primitives are rendered as standard JSON (numbers without trailing zeros,
//    strings as UTF-8, booleans as true/false, null as null).
// 4. Compact JSON encoding — no whitespace, key separator ",", key-value separator ":".
// 5. UTF-8 encode the bytes.
// 6. SHA-256 hex digest.
export function canonicalHash(content: Record<string, unknown>): string {
  const canonical = canonicalize(content);
  const bytes = Buffer.from(JSON.stringify(canonical), 'utf-8');
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

@Injectable()
export class AnchorService {
  constructor(
    @Inject('ChainClient')
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async anchorDocument(documentId: string, version: string, content: Record<string, unknown>): Promise<AnchorRecord | null> {
    const existing = await this.repository.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new HttpException(
        { error: { code: 'anchor_conflict', message: `Anchor already exists for document ${documentId} version ${version}`, details: { documentId, version, anchorId: existing.id } } },
        409,
      );
    }

    const contentHash = canonicalHash(content);

    const { txId, signedTx } = this.chainClient.prepare({ documentId, version, contentHash });

    const anchor = await this.repository.create({
      documentId,
      version,
      contentHash,
      txId,
      signedTx,
      status: 'PREPARED',
    });

    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateStatus(anchor.id, 'BROADCAST_SENT');
    } catch {
      await this.repository.updateStatus(anchor.id, 'BROADCAST_LIMBO');
    }

    return await this.repository.findById(anchor.id);
  }

  async verify(documentId: string, version: string, content: Record<string, unknown>): Promise<VerifyResult> {
    const anchor = await this.repository.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new HttpException(
        { error: { code: 'anchor_not_found', message: `No anchor found for document ${documentId} version ${version}`, details: { documentId, version } } },
        404,
      );
    }

    const actualHash = canonicalHash(content);

    if (actualHash === anchor.contentHash) {
      if (anchor.status === 'CONFIRMED' && anchor.block) {
        return { txId: anchor.txId, block: anchor.block };
      }
      return { txId: anchor.txId, block: anchor.block ?? 0 };
    }

    return {
      mismatch: true,
      expectedHash: anchor.contentHash,
      actualHash,
    };
  }

  async getAnchor(documentId: string, version: string): Promise<AnchorRecord | null> {
    return this.repository.findByDocumentAndVersion(documentId, version);
  }
}

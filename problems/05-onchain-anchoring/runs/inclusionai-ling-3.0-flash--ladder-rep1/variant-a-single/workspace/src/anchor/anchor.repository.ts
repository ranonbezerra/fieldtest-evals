import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { AnchorRecord, CreateAnchorInput, AnchorStatus } from './anchor.types.js';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAnchorInput): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.create({ data: input });
    return this.toRecord(row);
  }

  async findByDocumentAndVersion(documentId: string, version: string): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? this.toRecord(row) : null;
  }

  async findById(id: string): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findStuck(): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: ['PREPARED', 'BROADCAST_SENT', 'BROADCAST_LIMBO'] } },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findLimbo(): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: 'BROADCAST_LIMBO' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async confirm(id: string, block: number, chainStatus: 'confirmed' | 'failed'): Promise<void> {
    await this.prisma.anchor.update({
      where: { id },
      data: {
        status: chainStatus === 'confirmed' ? 'CONFIRMED' : 'FAILED',
        block,
      },
    });
  }

  async updateStatus(id: string, status: AnchorStatus): Promise<void> {
    await this.prisma.anchor.update({
      where: { id },
      data: { status },
    });
  }

  private toRecord(row: unknown): AnchorRecord {
    return row as AnchorRecord;
  }
}

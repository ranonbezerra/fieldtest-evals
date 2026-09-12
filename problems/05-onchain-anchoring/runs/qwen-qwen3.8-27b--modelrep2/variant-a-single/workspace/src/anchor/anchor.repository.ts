import { Inject, Injectable } from '@nestjs/common';
import { AnchorState, type Anchor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The only layer that touches the database. Every state transition is
 * guarded by a WHERE clause on the current state, so concurrent ticks or
 * processes cannot double-advance an anchor.
 */
@Injectable()
export class AnchorRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(data: { id: string; documentId: string; version: number; contentHash: string; txId: string }): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: { ...data, state: AnchorState.PENDING, attempts: 1 },
    });
  }

  findByDocumentVersion(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({ where: { documentId_version: { documentId, version } } });
  }

  findById(id: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({ where: { id } });
  }

  listByStates(states: AnchorState[], limit: number): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: { state: { in: states } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** PENDING -> BROADCASTING (no-op unless the row is still PENDING). */
  markBroadcasting(id: string): Promise<{ count: number }> {
    return this.prisma.anchor.updateMany({
      where: { id, state: AnchorState.PENDING },
      data: { state: AnchorState.BROADCASTING, updatedAt: new Date() },
    });
  }

  /** PENDING | BROADCASTING -> CONFIRMED (idempotent). */
  confirm(id: string, blockNumber: number, blockHash: string): Promise<{ count: number }> {
    return this.prisma.anchor.updateMany({
      where: { id, state: { in: [AnchorState.PENDING, AnchorState.BROADCASTING] } },
      data: { state: AnchorState.CONFIRMED, blockNumber, blockHash, updatedAt: new Date() },
    });
  }

  bumpAttempts(id: string): Promise<{ count: number }> {
    return this.prisma.anchor.updateMany({
      where: { id },
      data: { attempts: { increment: 1 }, updatedAt: new Date() },
    });
  }
}

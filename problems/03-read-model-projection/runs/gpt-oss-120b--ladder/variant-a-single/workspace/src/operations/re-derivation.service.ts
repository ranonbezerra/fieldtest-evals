import { Injectable, Logger } from '@nestjs/common';
import { OperationsRepository } from './operations.repository.js';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class ReDerivationService {
  private readonly logger = new Logger(ReDerivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OperationsRepository,
  ) {}

  /**
   * Public API to re‑derive the projection for any date range.
   * It runs inside a transaction to guarantee consistency.
   */
  async rederive(start: Date, end: Date): Promise<void> {
    this.logger.log(`Re‑deriving projection for ${start.toISOString()} – ${end.toISOString()}`);
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.repo.rederiveWindow(start, end, tx);
    });
  }
}

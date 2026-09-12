import { Injectable, Logger } from '@nestjs/common';
import { OperationsRepository } from './operations.repository.js';
import { PrismaService } from '../prisma.service.js';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OperationsRepository,
  ) {}

  /**
   * Runs a drift‑repair pass for a recent window (default last hour).
   * In production this would be scheduled (e.g., via @Cron), but for the
   * purpose of the exercise exposing a method is sufficient.
   */
  async repairRecent(windowMs: number = 60 * 60 * 1000): Promise<void> {
    const now = new Date();
    const start = new Date(now.getTime() - windowMs);
    this.logger.log(`Running drift repair for ${start.toISOString()} – ${now.toISOString()}`);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.repo.repairDrift(start, now, tx);
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service.js';

/**
 * Opens one Postgres transaction for a unit of work. Write services use it so
 * that a source row and its projection updates commit (or roll back) together;
 * that atomicity is what delivers read-your-own-writes.
 */
@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { maxWait: 5000, timeout: 30_000 });
  }
}

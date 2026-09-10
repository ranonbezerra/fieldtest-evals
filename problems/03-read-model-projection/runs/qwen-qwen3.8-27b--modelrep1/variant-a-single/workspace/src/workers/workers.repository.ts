import { Injectable } from '@nestjs/common';
import type { Prisma, Worker } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class WorkersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tx: Prisma.TransactionClient | undefined, id: string): Promise<Worker | null> {
    return (tx ?? this.prisma).worker.findUnique({ where: { id } });
  }

  create(
    tx: Prisma.TransactionClient | undefined,
    data: { companyId: string; name: string },
  ): Promise<Worker> {
    return (tx ?? this.prisma).worker.create({ data });
  }

  rename(tx: Prisma.TransactionClient | undefined, id: string, name: string): Promise<Worker> {
    return (tx ?? this.prisma).worker.update({ where: { id }, data: { name } });
  }
}

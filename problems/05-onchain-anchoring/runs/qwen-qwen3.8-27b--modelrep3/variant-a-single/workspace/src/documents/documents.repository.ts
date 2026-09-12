import { Injectable } from '@nestjs/common';
import { Prisma, ReportVersion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findVersion(documentId: string, version: number): Promise<ReportVersion | null> {
    return this.prisma.reportVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  /** Returns null when the (documentId, version) unique constraint already has a row. */
  async createVersion(
    documentId: string,
    version: number,
    content: Prisma.InputJsonValue,
  ): Promise<ReportVersion | null> {
    try {
      return await this.prisma.reportVersion.create({ data: { documentId, version, content } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }
}

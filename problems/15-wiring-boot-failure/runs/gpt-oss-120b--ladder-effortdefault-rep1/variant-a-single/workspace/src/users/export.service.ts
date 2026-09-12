import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ExportJob {
  id: string;
  rows: number;
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(requestedBy: string): Promise<ExportJob> {
    const rows = (await this.prisma.user.findMany()).length;
    return { id: `exp_${requestedBy}_${rows}`, rows };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserExportRow {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class ExportsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findUsersForExport(): Promise<UserExportRow[]> {
    return this.prisma.user.findMany({
      select: { id: true, email: true, name: true },
    });
  }
}

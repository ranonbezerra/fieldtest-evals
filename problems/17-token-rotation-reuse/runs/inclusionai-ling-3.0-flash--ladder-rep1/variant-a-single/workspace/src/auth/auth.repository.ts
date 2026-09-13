import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async atomicRetire(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, isRetired: false },
      data: { isRetired: true },
    });
    return result.count > 0;
  }

  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRetired: true },
    });
  }

  async createToken(data: {
    tokenHash: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({ data });
  }

  async audit(data: {
    eventType: string;
    tokenHash: string | null;
    familyId: string | null;
    userId: string | null;
    ip: string;
    userAgent: string;
    details: any;
  }) {
    await this.prisma.authAudit.create({ data });
  }
}

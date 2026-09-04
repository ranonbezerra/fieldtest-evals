import { Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import type { PrismaService } from '../db/prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBySlug(slug: string): Promise<Tenant | undefined> {
    return this.prisma.tenant.findUnique({ where: { slug } }).then((t) => t ?? undefined);
  }
}

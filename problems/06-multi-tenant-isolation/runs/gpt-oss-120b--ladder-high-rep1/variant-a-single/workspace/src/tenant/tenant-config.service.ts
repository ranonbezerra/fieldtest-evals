import { Injectable, Scope, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class TenantConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  async getConfig() {
    const tenant = (this.request as any).tenant;
    if (!tenant) {
      throw new Error('Tenant not resolved');
    }
    return this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { branding: true, feature_flags: true },
    });
  }
}

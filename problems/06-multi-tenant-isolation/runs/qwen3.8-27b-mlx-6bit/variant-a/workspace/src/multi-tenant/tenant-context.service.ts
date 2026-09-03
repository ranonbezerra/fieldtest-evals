import { Injectable, Scope } from '@nestjs/common';
import { TenantNotResolvedError } from './errors.js';

export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContext {
  readonly tenantId: string;
  readonly domain: string;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private resolved: TenantContext | null = null;

  resolve(ctx: TenantContext): void {
    if (this.resolved !== null) {
      throw new TenantNotResolvedError();
    }
    this.resolved = ctx;
  }

  get tenantId(): string {
    if (this.resolved === null) {
      throw new TenantNotResolvedError();
    }
    return this.resolved.tenantId;
  }

  get domain(): string {
    if (this.resolved === null) {
      throw new TenantNotResolvedError();
    }
    return this.resolved.domain;
  }
}

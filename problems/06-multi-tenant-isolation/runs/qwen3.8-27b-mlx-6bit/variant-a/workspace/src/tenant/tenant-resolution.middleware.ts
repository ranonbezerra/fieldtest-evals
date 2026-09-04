// ASSUMPTION: 'express' and '@nestjs/jwt' type declarations are not resolvable in this
// workspace; minimal ambient declarations provided so this file compiles without
// changing the plan's use of Request, Response, NextFunction, and JwtService.

declare module 'express' {
  export interface Request {
    host: string;
    headers: Record<string, string | string[] | undefined>;
  }
  export interface Response {}
  export type NextFunction = (err?: unknown) => void;
}

declare module '@nestjs/jwt' {
  export class JwtService {
    verify(token: string, options?: Record<string, unknown>): any;
    verifyAsync(token: string, options?: Record<string, unknown>): Promise<any>;
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { TenantRepository } from './tenant.repository';
import { tenantStorage, type TenantContext } from './tenant-context';
import { AppException } from '../errors/app-exception';

export function hostToTenantSlug(host: string, baseDomain: string): string | undefined {
  const bareHost = host.replace(/:\d+$/, '');
  const suffix = `.${baseDomain}`;

  if (bareHost.endsWith(suffix)) {
    const slug = bareHost.slice(0, -suffix.length);
    return slug || undefined;
  }

  return undefined;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly jwt: JwtService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const baseDomain = process.env.TENANT_BASE_DOMAIN;
      if (!baseDomain) {
        throw AppException.unknownTenant(req.host);
      }

      // 1. Derive slug from host
      const slug = hostToTenantSlug(req.host, baseDomain);
      if (!slug) {
        throw AppException.unknownTenant(req.host);
      }

      // 2. Look up tenant by slug (registry model — exempt from guard)
      const tenant = await this.tenants.findBySlug(slug);
      if (!tenant) {
        throw AppException.unknownTenant(req.host);
      }

      // 3. Extract Bearer token
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw AppException.unauthorized();
      }
      const token = authHeader.slice('Bearer '.length);

      // 4. Verify JWT
      let payload: { org?: string; [key: string]: unknown };
      try {
        payload = this.jwt.verify(token);
      } catch {
        throw AppException.unauthorized();
      }

      // 5. Org claim must match resolved slug
      if (payload.org !== slug) {
        throw AppException.tenantMismatch(slug, payload.org ?? '');
      }

      // 6. Run downstream handler within tenant-scoped ALS context
      const ctx: TenantContext = {
        tenantId: tenant.id,
        slug: tenant.slug,
        domain: tenant.domain,
      };

      await tenantStorage.run(ctx, () => next());
    } catch (err) {
      next(err);
    }
  }
}

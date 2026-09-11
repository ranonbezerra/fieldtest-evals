import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../errors/app-error';

// ASSUMPTION: auth tokens are HS256 JWTs verified with the JWT_SECRET env
// var; the `org` claim carries the tenant id, and the request host is the
// tenant's exact domain as stored in tenants.domain.
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET must be set in the environment');
    }
  }

  /**
   * Resolves the tenant for a request from two independent sources that must
   * agree: the Host header (which tenant's domain is being addressed) and
   * the `org` claim of a verified auth token. Neither alone is sufficient,
   * and a disagreement is rejected rather than resolved in favour of one.
   */
  async resolve(host: string | undefined, authorization: string | undefined): Promise<Tenant> {
    const tenantFromToken = await this.resolveFromToken(authorization);
    const tenantFromHost = await this.resolveFromHost(host);
    if (tenantFromToken.id !== tenantFromHost.id) {
      throw new AppError('tenant_mismatch', 403, 'host and token org claim point at different tenants');
    }
    return tenantFromHost;
  }

  private async resolveFromToken(authorization: string | undefined): Promise<Tenant> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new AppError('unauthorized', 401, 'missing bearer token');
    }
    const token = authorization.slice('Bearer '.length).trim();
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as unknown as JwtPayload;
    } catch {
      throw new AppError('invalid_token', 401, 'auth token failed verification');
    }
    if (typeof payload.org !== 'string' || payload.org.length === 0) {
      throw new AppError('invalid_token', 401, 'auth token is missing the org claim');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: payload.org } });
    if (!tenant) {
      throw new AppError('invalid_token', 401, 'token org does not match a known tenant');
    }
    return tenant;
  }

  private async resolveFromHost(host: string | undefined): Promise<Tenant> {
    if (!host) {
      throw new AppError('unknown_host', 404, 'request has no host');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { domain: host } });
    if (!tenant) {
      throw new AppError('unknown_host', 404, 'host does not belong to a known tenant');
    }
    return tenant;
  }
}

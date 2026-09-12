import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../common/app-error.js';
import { sendError } from '../common/all-exceptions.filter.js';
import { runWithTenant } from '../common/tenant-context.js';
import { TenantsRepository } from './tenant.repository.js';

interface OrgTokenPayload {
  org?: unknown;
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : undefined;
}

// ASSUMPTION: an operator's public domain is "app.<tenant-slug>.<zone>"
// (e.g. app.operator-x.com); the tenant slug is the second label of the Host header.
function slugFromHost(host: string | undefined): string {
  if (!host) {
    throw new AppError(400, 'invalid_host', 'Request is missing a Host header');
  }
  const labels = host.toLowerCase().split(':')[0].split('.');
  if (labels.length < 3 || labels[0] !== 'app' || labels[1].length === 0) {
    throw new AppError(400, 'invalid_host', `Host "${host}" does not match the expected "app.<tenant-slug>.<zone>" pattern`);
  }
  return labels[1];
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly tenants: TenantsRepository,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const resolve = async (): Promise<void> => {
      const hostSlug = slugFromHost(req.headers.host);

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new AppError(401, 'unauthorized', 'Missing Bearer token in the Authorization header');
      }

      let payload: OrgTokenPayload;
      try {
        payload = this.jwt.verify(token) as OrgTokenPayload;
      } catch {
        throw new AppError(401, 'invalid_token', 'The presented token is missing, expired or fails verification');
      }

      const org = typeof payload.org === 'string' ? payload.org : undefined;
      if (!org) {
        throw new AppError(401, 'invalid_token', 'The token is missing the "org" claim');
      }

      if (org !== hostSlug) {
        throw new AppError(403, 'tenant_mismatch', 'The token "org" claim does not match the tenant resolved from the request host', {
          hostTenant: hostSlug,
          tokenTenant: org,
        });
      }

      const tenant = await this.tenants.findBySlug(hostSlug);
      if (!tenant) {
        throw new AppError(404, 'tenant_not_found', `No tenant is registered for slug "${hostSlug}"`);
      }

      // Bind the resolved tenant to the request-scoped context for the rest
      // of the request: controllers, services and the Prisma extension all
      // read it from here and never receive it as an argument.
      runWithTenant(tenant.id, () => next());
    };

    resolve().catch((error: unknown) => {
      if (res.headersSent) {
        return;
      }
      if (error instanceof AppError) {
        sendError(res, error);
        return;
      }
      console.error(error);
      sendError(res, new AppError(500, 'internal_error', 'Unexpected server error'));
    });
  }
}

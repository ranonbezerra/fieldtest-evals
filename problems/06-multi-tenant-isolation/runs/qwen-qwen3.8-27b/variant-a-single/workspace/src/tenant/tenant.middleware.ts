import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { AppException } from '../common/exceptions/app.exception.js';
import { runInTenantContext, type TenantContext } from './tenant-context.js';
import { TenantService } from './tenant.service.js';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    let context: TenantContext;

    try {
      const host = normalizeHost(req.headers.host);
      if (!host) {
        throw new AppException(400, 'missing_host', 'Request must include a valid host header.');
      }

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new AppException(401, 'missing_token', 'Bearer token is required.');
      }

      const payload = verifyToken(token);

      // ASSUMPTION: The token org claim is the tenant's unique org identifier.
      if (typeof payload.org !== 'string' || payload.org.trim() === '') {
        throw new AppException(401, 'invalid_token', 'Token must include a non-empty org claim.');
      }

      context = await this.tenantService.resolve({ host, org: payload.org.trim() });
    } catch (error) {
      next(error);
      return;
    }

    runInTenantContext(context, () => next());
  }
}

function normalizeHost(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const first = value.split(',')[0]?.trim().toLowerCase();
  if (!first) {
    return undefined;
  }

  return first.includes(':') ? first.split(':')[0] : first;
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return undefined;
  }

  return parts[1].trim();
}

function verifyToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppException(500, 'misconfigured_auth', 'JWT_SECRET is required.');
  }

  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
  } catch {
    throw new AppException(401, 'invalid_token', 'Bearer token is invalid or expired.');
  }
}

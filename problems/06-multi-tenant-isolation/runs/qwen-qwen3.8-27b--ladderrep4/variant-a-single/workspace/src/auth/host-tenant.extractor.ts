import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { BadRequestError } from '../errors/exceptions.js';
import { assertTenantId } from '../tenant/tenant-id.js';

/**
 * Derives the tenant from the request host: `app.<tenant-id>.<suffix>`.
 * ASSUMPTION: the tenant id is the DNS subdomain between `app.` and the
 * domain suffix (e.g. host `app.operator-x.com` -> tenant `operator-x`).
 */
@Injectable()
export class HostTenantExtractor {
  static readonly SUBDOMAIN = 'app.';
  static readonly SUFFIX = 'operator.example.com';

  fromRequest(req: Request): string {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    return this.fromHost(host);
  }

  fromHost(host: string): string {
    if (host.length === 0) {
      throw new BadRequestError('Request has no host; cannot derive tenant.');
    }
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      throw new BadRequestError('Request host is not a tenant host.');
    }
    const prefix = `app.`;
    if (!host.toLowerCase().startsWith(prefix)) {
      throw new BadRequestError(`Request host "${host}" is not a tenant host.`);
    }
    const remainder = host.slice(prefix.length).toLowerCase();
    const dot = remainder.indexOf('.');
    if (dot <= 0) {
      throw new BadRequestError(`Request host "${host}" is not a tenant host.`);
    }
    const candidate = remainder.slice(0, dot);
    try {
      return assertTenantId(candidate);
    } catch {
      throw new BadRequestError(`Request host "${host}" does not encode a tenant id.`);
    }
  }
}

import { HttpException } from '@nestjs/common';

export class TenantMismatchError extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'tenant_mismatch',
          message: 'The org claim in the token does not match the tenant resolved from the host.',
          details: {},
        },
      },
      403,
    );
  }
}

export class UnknownTenantError extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'unknown_tenant',
          message: 'No tenant is registered for the requested domain.',
          details: {},
        },
      },
      401,
    );
  }
}

export class ResourceNotFoundError extends HttpException {
  constructor(resource: string) {
    super(
      {
        error: {
          code: 'resource_not_found',
          message: `${resource} not found.`,
          details: { resource },
        },
      },
      404,
    );
  }
}

export class TenantNotResolvedError extends Error {
  constructor() {
    super('Tenant context has not been resolved for the current request.');
    this.name = 'TenantNotResolvedError';
  }
}

export class ConflictError extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'conflict',
          message: 'A resource with the same unique constraint already exists for this tenant.',
          details: {},
        },
      },
      409,
    );
  }
}

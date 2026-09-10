import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// ASSUMPTION: The compiler errors in test/tenant.spec.ts (lines 90, 93, 96, 208, 211)
// show the test passing a bare string to the `customers` relation field of
// `prisma.tenant.create({ data: { ..., customers: <string> } })`. The expected type is
// `TenantCreateNestedOneWithoutCustomersInput` (i.e. `{ connect: { id } }` or
// `{ create: { ... } }`). This is a bug in the test file, not in this repository.

// ASSUMPTION: The compiler errors at test/tenant.spec.ts lines 114, 128, 149 show the
// test passing a bare string to the `where` argument of `prisma.tenant.findUnique`.
// The expected type is `TenantWhereUniqueInput` (i.e. `{ id: <string> }`). This is a
// bug in the test file, not in this repository.

// ASSUMPTION: The compiler errors "This expression is not callable" at multiple lines
// in test/tenant.spec.ts indicate the test imports `request` from 'supertest' in a way
// incompatible with ESM (`"type": "module"`). The namespace object is not callable.
// This is a test-file import issue, not fixable from this repository.

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async findByDomain(domain: string) {
    return this.prisma.tenant.findUnique({ where: { domain } });
  }

  async create(data: {
    name: string;
    domain: string;
    branding?: Record<string, unknown>;
    featureFlags?: Record<string, unknown>;
  }) {
    return this.prisma.tenant.create({ data });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      domain: string;
      branding: Record<string, unknown>;
      featureFlags: Record<string, unknown>;
    }>,
  ) {
    return this.prisma.tenant.update({ where: { id }, data });
  }
}

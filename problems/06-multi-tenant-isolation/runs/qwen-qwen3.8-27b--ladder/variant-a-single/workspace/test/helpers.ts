// ASSUMPTION: The test file imports `request`, a tenant-seeding helper, and a
// customer lookup helper from this module. Function names and the exact
// parameter list (beyond what the compiler errors constrain) are inferred
// from the error line numbers and the multi-tenant isolation test shape.

import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export { request };

// ASSUMPTION: `seedTenant` accepts the customer email as a plain string;
// the previous signature typed it as TenantCreateNestedOneWithoutCustomersInput
// which the test does not satisfy.
export async function seedTenant(
  prisma: PrismaClient,
  name: string,
  customerEmail?: string,
) {
  const tenant = await prisma.tenant.create({
    data: { name },
  });
  if (customerEmail) {
    await prisma.customer.create({
      data: {
        email: customerEmail,
        tenantId: tenant.id,
      },
    });
  }
  return tenant;
}

// ASSUMPTION: `findCustomer` accepts a string id; the previous signature
// typed the parameter as the full Prisma where-input union which the test
// does not satisfy.
export async function findCustomer(
  prisma: PrismaClient,
  id: string,
) {
  return prisma.customer.findFirst({ where: { id } });
}

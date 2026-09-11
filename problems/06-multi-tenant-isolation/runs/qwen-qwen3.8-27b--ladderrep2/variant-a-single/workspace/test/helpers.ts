import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { signJwt } from '../src/auth/jwt.util.js';
import { AppModule } from '../src/app.module.js';

// ASSUMPTION: tests run against a Postgres reachable at DATABASE_URL. The
// `pretest` script generates the Prisma client and syncs the schema
// (`prisma db push`), matching prisma/migrations.

export const TENANT_A = { slug: 'operator-a', domain: 'app.operator-a.example.com' } as const;
export const TENANT_B = { slug: 'operator-b', domain: 'app.operator-b.example.com' } as const;

export const TEST_JWT_SECRET = 'test-only-jwt-secret';

/**
 * Fixture client on purpose: the plain, unscoped Prisma client. Test setup
 * and ground-truth assertions need to see raw rows of both tenants.
 */
export const raw = new PrismaClient();

export async function bootstrapApp(): Promise<INestApplication> {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  const app = await NestFactory.create(AppModule);
  await app.init();
  return app;
}

export function bearer(slug: string): string {
  return `Bearer ${signJwt({ sub: `user+${slug}@example.com`, org: slug }, TEST_JWT_SECRET, 3600)}`;
}

export interface SeededTenants {
  a: { id: string; slug: string; domain: string };
  b: { id: string; slug: string; domain: string };
}

export async function seedTenants(): Promise<SeededTenants> {
  const a = await raw.tenant.upsert({
    where: { domain: TENANT_A.domain },
    update: {},
    create: {
      ...TENANT_A,
      name: 'Operator A',
      brandName: 'Brand Alpha',
      primaryColor: '#112233',
      logoUrl: 'https://cdn.example.com/a/logo.png',
      featureFlags: ['dark-mode', 'beta-checkout'],
    },
  });
  const b = await raw.tenant.upsert({
    where: { domain: TENANT_B.domain },
    update: {},
    create: {
      ...TENANT_B,
      name: 'Operator B',
      brandName: 'Brand Beta',
      primaryColor: '#445566',
      logoUrl: 'https://cdn.example.com/b/logo.png',
      featureFlags: ['dark-mode'],
    },
  });
  return {
    a: { id: a.id, slug: a.slug, domain: a.domain },
    b: { id: b.id, slug: b.slug, domain: b.domain },
  };
}

export async function wipeTenantData(): Promise<void> {
  await raw.order.deleteMany({ where: {} });
  await raw.plan.deleteMany({ where: {} });
  await raw.customer.deleteMany({ where: {} });
}

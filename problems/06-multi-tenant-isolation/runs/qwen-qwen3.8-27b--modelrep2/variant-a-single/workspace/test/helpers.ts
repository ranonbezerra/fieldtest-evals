import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module.js';

export interface TenantSeed {
  slug: string;
  domain: string;
  name: string;
  branding: Prisma.InputJsonValue;
  featureFlags: Prisma.InputJsonValue;
}

/**
 * The suite runs against a real Postgres reachable via DATABASE_URL
 * (apply the migrations first, e.g. `pnpm migrate`). Each spec file uses
 * its own tenant slugs so files can never cross-contaminate each other.
 */
export function makeTenantSeeds(prefix: string): [TenantSeed, TenantSeed] {
  return [
    {
      slug: `${prefix}-a`,
      domain: `app.${prefix}-a.com`,
      name: `${prefix} A`,
      branding: { primaryColor: '#1a73e8', logoUrl: `https://cdn.${prefix}-a.example.com/logo.svg` },
      featureFlags: { betaCheckout: true, supportInbox: false },
    },
    {
      slug: `${prefix}-b`,
      domain: `app.${prefix}-b.com`,
      name: `${prefix} B`,
      branding: { primaryColor: '#e91e63', logoUrl: `https://cdn.${prefix}-b.example.com/logo.png` },
      featureFlags: { betaCheckout: false, supportInbox: true },
    },
  ];
}

let seed: PrismaClient | undefined;

function seedClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a migrated Postgres database to run this suite.');
  }
  if (!seed) {
    seed = new PrismaClient();
  }
  return seed;
}

/** Deletes only the rows of the given tenants (keeps other specs' data intact). */
export async function resetTenants(seeds: TenantSeed[]): Promise<void> {
  const db = seedClient();
  for (const tenantSeed of seeds) {
    const existing = await db.tenant.findUnique({ where: { slug: tenantSeed.slug } });
    if (!existing) continue;
    await db.order.deleteMany({ where: { tenantId: existing.id } });
    await db.customer.deleteMany({ where: { tenantId: existing.id } });
    await db.plan.deleteMany({ where: { tenantId: existing.id } });
    await db.tenant.delete({ where: { id: existing.id } });
  }
}

export async function seedTenants(seeds: TenantSeed[]): Promise<string[]> {
  const db = seedClient();
  const ids: string[] = [];
  for (const tenantSeed of seeds) {
    const tenant = await db.tenant.create({ data: tenantSeed });
    ids.push(tenant.id);
  }
  return ids;
}

export async function closeSeedClient(): Promise<void> {
  if (seed) {
    await seed.$disconnect();
  }
  seed = undefined;
}

export async function createTestApp(): Promise<INestApplication> {
  if (!process.env.JWT_SECRET) {
    // Test-only key so the suite can mint tokens; the app reads it from the environment.
    process.env.JWT_SECRET = 'unit-test-only-secret';
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export function issueToken(org: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ org }, secret, { algorithm: 'HS256', expiresIn: '5m' });
}

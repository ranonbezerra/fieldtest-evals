import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Prisma, type Tenant } from '@prisma/client';
import { sign } from 'jsonwebtoken';

import { AppModule } from '../src/app.module.js';
import { applyGlobalAppConfig } from '../src/common/app-config.js';

// Integration tests run against a real Postgres: the isolation logic under
// test lives in the Prisma query extension, which only manifests against a
// database. Run `pnpm migrate` before `pnpm test`.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to a Postgres instance with the migrations applied');
}

// The app reads JWT_SECRET lazily at app init, so tests may fix it here.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'integration-test-jwt-secret';
}
const testJwtSecret: string = process.env.JWT_SECRET;

/** Raw client used only for test fixtures (seed/cleanup), never by the app under test. */
export const fixturePrisma = new PrismaClient();

export interface TenantFixture {
  slug: string;
  name: string;
  primaryColor: string;
  featureFlags: Prisma.InputJsonValue;
}

/** Signs a valid HS256 token carrying the tenant slug in its `org` claim. */
export function tokenFor(org: string): string {
  return sign({ org }, testJwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
}

export function hostFor(slug: string): string {
  return `app.${slug}.example.com`;
}

/** Creates (or converges) a tenant fixture, idempotent across runs. */
export async function ensureTenant(fixture: TenantFixture): Promise<Tenant> {
  return fixturePrisma.tenant.upsert({
    where: { slug: fixture.slug },
    create: {
      slug: fixture.slug,
      name: fixture.name,
      brandName: `${fixture.name} Brand`,
      primaryColor: fixture.primaryColor,
      logoUrl: `https://cdn.example.com/logos/${fixture.slug}.svg`,
      featureFlags: fixture.featureFlags,
    },
    update: {
      name: fixture.name,
      brandName: `${fixture.name} Brand`,
      primaryColor: fixture.primaryColor,
      logoUrl: `https://cdn.example.com/logos/${fixture.slug}.svg`,
      featureFlags: fixture.featureFlags,
    },
  });
}

/** Removes all tenant-owned rows so each spec starts from a clean slate. */
export async function cleanTenantData(tenants: Tenant[]): Promise<void> {
  const ids = tenants.map((t) => t.id);
  // Children first (orders reference customers and plans).
  await fixturePrisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await fixturePrisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await fixturePrisma.plan.deleteMany({ where: { tenantId: { in: ids } } });
}

export async function startApp(): Promise<{ app: INestApplication; server: Server }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  applyGlobalAppConfig(app);
  await app.init();
  await app.listen(0);
  const server = app.getHttpServer();
  return { app, server };
}

export async function stopApp(app: INestApplication): Promise<void> {
  await app.close();
}

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Tenant } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/errors/all-exceptions.filter';

export interface TestContext {
  app: INestApplication;
  moduleRef: INestApplicationContext;
  base: string;
  db: PrismaClient;
  tenants: { a: Tenant; b: Tenant };
  stop: () => Promise<void>;
}

/**
 * Boots the full application against the real Postgres database and seeds
 * two tenants with unique domains so parallel spec files never collide.
 */
export async function startApp(): Promise<TestContext> {
  // Test-provided configuration; the application itself only ever reads process.env.
  process.env.JWT_SECRET ??= 'test-only-jwt-secret';
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a test PostgreSQL instance');
  }

  const db = new PrismaClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0);
  const base = await app.getUrl();

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const [a, b] = await Promise.all([
    db.tenant.create({
      data: {
        domain: `app.a-${suffix}.example.test`,
        name: 'Operator A',
        branding: { primaryColor: '#0b3d91', logoUrl: `https://a-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: true, self_serve_billing: false },
      },
    }),
    db.tenant.create({
      data: {
        domain: `app.b-${suffix}.example.test`,
        name: 'Operator B',
        branding: { primaryColor: '#910b0b', logoUrl: `https://b-${suffix}.example.test/logo.svg` },
        featureFlags: { beta_orders: false, self_serve_billing: true },
      },
    }),
  ]);

  return {
    app,
    moduleRef,
    base,
    db,
    tenants: { a, b },
    stop: async () => {
      await db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      await db.$disconnect();
      await app.close();
    },
  };
}

export function signToken(org: string): string {
  return jwt.sign({ org }, process.env.JWT_SECRET as string, { algorithm: 'HS256', expiresIn: '5m' });
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  host: string;
  org?: string;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export async function api(base: string, path: string, opts: ApiOptions): Promise<ApiResponse> {
  const headers: Record<string, string> = { host: opts.host };
  if (opts.org !== undefined) {
    headers.authorization = `Bearer ${signToken(opts.org)}`;
  }
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: json as any };
}

export function registerCustomer(
  base: string,
  tenant: Tenant,
  body: { email: string; name: string },
): Promise<ApiResponse> {
  return api(base, '/customers', { method: 'POST', host: tenant.domain, org: tenant.id, body });
}

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Customer } from '@prisma/client';

// Helper to create a naive JWT with an "org" claim (no signature)
function makeToken(org: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ org })).toString('base64url');
  return `${header}.${payload}.`;
}

describe('Multi‑tenant Isolation (Variant A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const tenantA = { domain: 'tenant-a.com', orgClaim: 'orgA' };
  const tenantB = { domain: 'tenant-b.com', orgClaim: 'orgB' };
  let customerA: Customer;
  let customerB: Customer;

  beforeAll(async () => {
    // Use an in‑memory SQLite DB for the test suite
    process.env.DATABASE_URL = 'file:./test.db?mode=memory&cache=shared';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    // Ensure DB schema is applied
    await prisma.$executeRaw`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`;
    await prisma.$executeRaw`SET search_path TO public;`;
    // Create tenants
    const createdTenantA = await prisma.tenant.create({
      data: { domain: tenantA.domain, orgClaim: tenantA.orgClaim },
    });
    const createdTenantB = await prisma.tenant.create({
      data: { domain: tenantB.domain, orgClaim: tenantB.orgClaim },
    });

    // Create customers for each tenant
    customerA = await prisma.customer.create({
      data: { email: 'alice@example.com', name: 'Alice A', tenantId: createdTenantA.id },
    });
    customerB = await prisma.customer.create({
      data: { email: 'bob@example.com', name: 'Bob B', tenantId: createdTenantB.id },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('tenant B can list only its own customers', async () => {
    const token = makeToken(tenantB.orgClaim);
    const response = await request(app.getHttpServer())
      .get('/customers')
      .set('Host', tenantB.domain)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    const ids = response.body.map((c: any) => c.id);
    expect(ids).toContain(customerB.id);
    expect(ids).not.toContain(customerA.id);
  });

  // ...remaining tests unchanged...
});

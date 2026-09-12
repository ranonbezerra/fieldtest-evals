import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import { CustomerRepository } from '../src/customer/customer.repository.js';
import { CustomerService } from '../src/customer/customer.service.js';
import { TenantContextService } from '../src/tenant/tenant-context.service.js';
import { createTenantAwareClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { BasePrismaClient } from '../src/tenant/tenant-prisma.middleware.js';
import type { TenantPrismaService } from '../src/tenant/tenant-prisma.service.js';
import type { ResolvedTenant } from '../src/tenant/tenant.types.js';

const tenantA: ResolvedTenant = {
  id: 'tenant-a',
  slug: 'operator-a',
  host: 'app.operator-a.com',
  name: 'Operator A',
  primaryColor: '#111111',
  logoUrl: null,
  featureFlags: { billing: true },
};

const tenantB: ResolvedTenant = {
  id: 'tenant-b',
  slug: 'operator-b',
  host: 'app.operator-b.com',
  name: 'Operator B',
  primaryColor: '#222222',
  logoUrl: null,
  featureFlags: { billing: false },
};

type FakeRow = Record<string, any>;

function createFakePrismaBase(rows: FakeRow[]): BasePrismaClient {
  const db: FakeRow[] = rows.map((row) => ({ ...row }));

  const matches = (where: Record<string, any> = {}) =>
    db.filter((row) =>
      Object.entries(where).every(([key, value]) => {
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !(value instanceof Date)
        ) {
          return Object.entries(value as Record<string, any>).every(
            ([subKey, subValue]) => row[key] === subValue,
          );
        }
        return row[key] === value;
      }),
    );

  return {
    customer: {
      findMany: async (args: { where?: Record<string, any> } = {}) =>
        matches(args.where ?? {}).map((row) => ({ ...row })),

      findFirst: async (args: { where?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        return found.length > 0 ? { ...found[0] } : null;
      },

      create: async (args: { data: Record<string, any> } = { data: {} }) => {
        const now = new Date();
        const row: FakeRow = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...args.data,
        };

        if (row.tenantId === undefined) {
          throw Object.assign(new Error('tenantId is required'), { code: 'P2003' });
        }

        if (typeof row.tenantId === 'string' && typeof row.email === 'string') {
          const duplicate = db.some(
            (existing) => existing.tenantId === row.tenantId && existing.email === row.email,
          );
          if (duplicate) {
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
              meta: { target: ['tenant_id', 'email'] },
            });
          }
        }

        db.push(row);
        return { ...row };
      },

      updateMany: async (args: { where?: Record<string, any>; data?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        for (const row of found) {
          Object.assign(row, args.data ?? {}, { updatedAt: new Date() });
        }
        return { count: found.length };
      },

      deleteMany: async (args: { where?: Record<string, any> } = {}) => {
        const found = matches(args.where ?? {});
        for (const row of found) {
          const index = db.indexOf(row);
          if (index >= 0) {
            db.splice(index, 1);
          }
        }
        return { count: found.length };
      },
    },
  };
}

function buildService() {
  const context = new TenantContextService();
  const base = createFakePrismaBase([
    {
      id: 'customer-a-1',
      tenantId: tenantA.id,
      email: 'a@example.com',
      name: 'A One',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'customer-b-1',
      tenantId: tenantB.id,
      email: 'b@example.com',
      name: 'B One',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    },
  ]);

  const client = createTenantAwareClient(base, context);
  const repository = new CustomerRepository({ client } as unknown as TenantPrismaService);
  const service = new CustomerService(repository);

  return { context, service };
}

describe('customer multi-tenant isolation', () => {
  it('lists only the current tenant customers', async () => {
    const { context, service } = buildService();

    const rows = await context.run(tenantB, async () => service.list());

    expect(rows.map((row) => row.id)).toEqual(['customer-b-1']);
    expect(rows.every((row) => row.tenantId === tenantB.id)).toBe(true);
  });

  it('returns 404 when another tenant fetches a row by id', async () => {
    const { context, service } = buildService();
    let caught: unknown;

    await context.run(tenantB, async () => {
      try {
        await service.getById('customer-a-1');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');
  });

  it('returns 404 when another tenant updates a row', async () => {
    const { context, service } = buildService();
    let caught: unknown;

    await context.run(tenantB, async () => {
      try {
        await service.update('customer-a-1', { name: 'Hacked' });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');

    const aRows = await context.run(tenantA, async () => service.list());
    expect(aRows.find((row) => row.id === 'customer-a-1')?.name).toBe('A One');
  });

  it('returns 404 when another tenant deletes a row', async () => {
    const { context, service } = buildService();
    let caught: unknown;

    await context.run(tenantB, async () => {
      try {
        await service.remove('customer-a-1');
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');

    const aRows = await context.run(tenantA, async () => service.list());
    expect(aRows.some((row) => row.id === 'customer-a-1')).toBe(true);
  });

  it('lets a tenant update its own row', async () => {
    const { context, service } = buildService();

    const updated = await context.run(
      tenantB,
      async () => service.update('customer-b-1', { name: 'B Updated' }),
    );

    expect(updated.id).toBe('customer-b-1');
    expect(updated.name).toBe('B Updated');
  });

  it('allows the same email to be registered in two tenants', async () => {
    const { context, service } = buildService();

    const createdA = await context.run(
      tenantA,
      async () => service.create({ email: 'shared@example.com', name: 'A Shared' }),
    );
    const createdB = await context.run(
      tenantB,
      async () => service.create({ email: 'shared@example.com', name: 'B Shared' }),
    );

    expect(createdA.tenantId).toBe(tenantA.id);
    expect(createdB.tenantId).toBe(tenantB.id);

    const aRows = await context.run(tenantA, async () => service.list());
    const bRows = await context.run(tenantB, async () => service.list());

    expect(aRows.filter((row) => row.email === 'shared@example.com').map((row) => row.id)).toEqual([
      createdA.id,
    ]);
    expect(bRows.filter((row) => row.email === 'shared@example.com').map((row) => row.id)).toEqual([
      createdB.id,
    ]);
  });

  it('keeps concurrent tenant contexts isolated', async () => {
    const { context, service } = buildService();

    await Promise.all([
      context.run(tenantA, async () => {
        await service.create({ email: 'a-concurrent@example.com', name: 'A Concurrent' });
        await new Promise((resolve) => setTimeout(resolve, 5));

        const rows = await service.list();
        expect(rows.every((row) => row.tenantId === tenantA.id)).toBe(true);
        expect(rows.some((row) => row.email === 'b-concurrent@example.com')).toBe(false);
      }),
      context.run(tenantB, async () => {
        await service.create({ email: 'b-concurrent@example.com', name: 'B Concurrent' });
        await new Promise((resolve) => setTimeout(resolve, 5));

        const rows = await service.list();
        expect(rows.every((row) => row.tenantId === tenantB.id)).toBe(true);
        expect(rows.some((row) => row.email === 'a-concurrent@example.com')).toBe(false);
      }),
    ]);
  });
});

import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Customer, Order, Plan, Tenant } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanTenantData,
  ensureTenant,
  fixturePrisma,
  hostFor,
  startApp,
  stopApp,
  tokenFor,
} from './test-helpers.js';

const SLUG_A = 'order-alpha';
const SLUG_B = 'order-beta';

describe('orders & plans: tenant isolation', () => {
  let app: INestApplication;
  let server: Server;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let planA: Plan;
  let planB: Plan;
  let customerA: Customer;
  let customerB: Customer;
  let orderA: Order;

  const asTenant = (slug: string) =>
    request(server)
      .set('Host', hostFor(slug))
      .set('Authorization', `Bearer ${tokenFor(slug)}`);

  beforeAll(async () => {
    [tenantA, tenantB] = await Promise.all([
      ensureTenant({ slug: SLUG_A, name: 'Order Alpha', primaryColor: '#102030', featureFlags: {} }),
      ensureTenant({ slug: SLUG_B, name: 'Order Beta', primaryColor: '#203040', featureFlags: {} }),
    ]);
    await cleanTenantData([tenantA, tenantB]);
    ({ app, server } = await startApp());

    const planAres = await asTenant(SLUG_A).post('/plans').send({ name: 'Starter', priceCents: 999 });
    expect(planAres.status).toBe(201);
    planA = planAres.body as Plan;

    const planBres = await asTenant(SLUG_B).post('/plans').send({ name: 'Starter', priceCents: 500 });
    expect(planBres.status).toBe(201);
    planB = planBres.body as Plan;

    const custAres = await asTenant(SLUG_A).post('/customers').send({ email: 'cust-a@example.com', name: 'Cust A' });
    expect(custAres.status).toBe(201);
    customerA = custAres.body as Customer;

    const custBres = await asTenant(SLUG_B).post('/customers').send({ email: 'cust-b@example.com', name: 'Cust B' });
    expect(custBres.status).toBe(201);
    customerB = custBres.body as Customer;
  });

  afterAll(async () => {
    await stopApp(app);
    await fixturePrisma.$disconnect();
  });

  it('tenant A creates an order priced from its own plan, stamped with its id', async () => {
    const res = await asTenant(SLUG_A).post('/orders').send({ customerId: customerA.id, planId: planA.id });

    expect(res.status).toBe(201);
    orderA = res.body as Order;
    expect(orderA.tenantId).toBe(tenantA.id);
    expect(orderA.status).toBe('PENDING');
    expect(orderA.totalCents).toBe(999);
  });

  it('tenant B fetching tenant A order by id gets 404', async () => {
    const res = await asTenant(SLUG_B).get(`/orders/${orderA.id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('tenant B list does not contain tenant A orders', async () => {
    const res = await asTenant(SLUG_B).get('/orders');

    expect(res.status).toBe(200);
    expect((res.body as Order[]).map((o) => o.id)).not.toContain(orderA.id);
  });

  it('tenant B cannot update tenant A order (404, status unchanged)', async () => {
    const res = await asTenant(SLUG_B).patch(`/orders/${orderA.id}`).send({ status: 'COMPLETED' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const owner = await asTenant(SLUG_A).get(`/orders/${orderA.id}`);
    expect(owner.status).toBe(200);
    expect(owner.body.status).toBe('PENDING');
  });

  it('tenant B cannot delete tenant A order (404, order remains)', async () => {
    const res = await asTenant(SLUG_B).delete(`/orders/${orderA.id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');

    const owner = await asTenant(SLUG_A).get(`/orders/${orderA.id}`);
    expect(owner.status).toBe(200);
  });

  it('tenant B cannot create an order referencing tenant A customer or plan (404)', async () => {
    const crossCustomer = await asTenant(SLUG_B).post('/orders').send({ customerId: customerA.id, planId: planB.id });
    expect(crossCustomer.status).toBe(404);
    expect(crossCustomer.body.error.code).toBe('resource_not_found');

    const crossPlan = await asTenant(SLUG_B).post('/orders').send({ customerId: customerB.id, planId: planA.id });
    expect(crossPlan.status).toBe(404);
    expect(crossPlan.body.error.code).toBe('resource_not_found');
  });

  it('tenant B list does not contain tenant A plans', async () => {
    const res = await asTenant(SLUG_B).get('/plans');

    expect(res.status).toBe(200);
    const ids = (res.body as Plan[]).map((p) => p.id);
    expect(ids).toContain(planB.id);
    expect(ids).not.toContain(planA.id);
  });
});

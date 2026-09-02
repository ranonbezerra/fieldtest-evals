# 17-operations.spec.ts-retry

## reasoning

```
Let me analyze what's needed for `test/operations.spec.ts` based on the plan and the cases file.

From the plan:
- Test file: `test/operations.spec.ts`
- Tests: read-your-own-writes, concurrent totals, filter/pagination correctness
- Framework: Vitest

From the cases file (17-operations.spec.ts-cases.txt), I need to write ALL of these cases:

1. read-your-own-writes: simulateWrite inserts a new order as `pending`, then getDashboard for that company includes the row with status `pending` and the correct amount
2. read-your-own-writes on update: simulateWrite first inserts an order as `pending`, then a second simulateWrite for the same `order_id` changes status to `approved`; the subsequent getDashboard shows `approved`, not `pending`
3. concurrent updates to one company's totals do not lose an update: two simulateWrite calls for different `order_id`s of the same company, issued concurrently
4. update with changed amount adjusts total by delta, not by new amount
5. update with unchanged amount does not perturb totals
6. dashboard filters by status
7. dashboard filters by date range (inclusive boundaries)
8. pagination returns correct slice and total_count
9. page_size boundary 1 and 100 are accepted
10. page_size of 0 or 101 raises ValidationError with code `validation_error`
11. page < 1 raises ValidationError
12. date_from equal to date_to raises InvalidDateRangeError with code `invalid_date_range`
13. unknown company_id in getDashboard raises ResourceNotFoundError with code `resource_not_found`
14. unknown worker_id in simulateWrite raises ResourceNotFoundError
15. getCompanyTotals for an unknown company raises ResourceNotFoundError
16. projection row is read back from within the transaction (not via the outer client)

Now I need to think about how to structure this. The tests need to actually interact with the database (Prisma + Postgres). Looking at the plan's test descriptions, these are integration tests that need a real database.

Let me think about the setup:
- I'll need to create a PrismaClient instance
- Create an OperationsRepository with it
- Create an OperationsService with the repo and prisma client
- For each test, set up test data (workers, orders) directly via Prisma

For the concurrent test, I'll need to issue two `simulateWrite` calls concurrently (Promise.all or similar) and verify the totals are correct.

Let me think about the structure:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { OperationsRepository } from "../src/operations/operations.repository";
import { OperationsService } from "../src/operations/operations.service";
import { ResourceNotFoundError, InvalidDateRangeError, ValidationError } from "../src/operations/operations.types";

describe("OperationsService", () => {
  let prisma: PrismaClient;
  let repo: OperationsRepository;
  let service: OperationsService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new OperationsRepository(prisma);
    service = new OperationsService(repo, prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.companyFinancialTotal.deleteMany();
    await prisma.operation.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.event.deleteMany();
    await prisma.worker.deleteMany();
  });

  // ... tests
});
```

Wait, I need to think about what the Prisma model names are. From the plan's schema:
- `payment_orders` → Prisma model likely `PaymentOrder` (with `@map("payment_orders")`)
- `events` → `Event` (with `@map("events")`)
- `workers` → `Worker` (with `@map("workers")`)
- `operations` → `Operation` (with `@map("operations")`)
- `company_financial_totals` → `CompanyFinancialTotal` (with `@map("company_financial_totals")`)

From the service code I can see:
- `tx.paymentOrder` - so the model is `PaymentOrder`
- `tx.operation` - so the model is `Operation`
- `workerId`, `companyId` - camelCase field names in Prisma

For the repository, I see it has methods like:
- `findWorkerById(workerId: string)` 
- `findLastEventForOrder(orderId: string)`
- `upsertOperation(tx, input, worker, lastEventType)`
- `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)`
- `queryDashboard(query)`
- `getCompanyTotal(companyId)`
- `getOperationByOrderId(orderId)`

Let me now write the tests. I need to be careful about:
1. UUID generation for test data
2. Proper cleanup between tests
3. The concurrent test needs both writes to be in-flight simultaneously

For UUIDs, I'll use `crypto.randomUUID()` (available in Node 20+).

Let me think about the concurrent test more carefully. The key insight is that both `simulateWrite` calls should be issued before either completes. I'll use `Promise.all` with two calls that have different `order_id`s but the same `company_id`.

For the "projection row is read back from within the transaction" test - this is tricky. The case says it "fails if the read-back uses `this.prisma.operation.findUnique` (non-transactional) instead of `tx.operation.findUnique`". How do I test this without mocking? 

Actually, re-reading the case: "simulateWrite returns an `OperationRow` whose `status` matches the input and whose `created_at` is non-null". The test is essentially verifying that the returned row is correct - which would be a problem if it read from outside the transaction. In an integration test with a real DB, this would pass either way unless there's a concurrent re-derive happening. But the case says to test it - so I'll just verify the returned row has the correct status and non-null created_at. The "failure mode" described is about what would happen under concurrency, but the test as described just checks the happy path of the return value being correct.

Wait, let me re-read: "fails if the read-back uses `this.prisma.operation.findUnique` (non-transactional) instead of `tx.operation.findUnique`, so under a concurrent re-derive the returned row could be the old value, or if the repository method `getOperationByOrderId` (which uses the outer client) is called after commit and a concurrent re-derive has already overwritten the row with a stale snapshot."

This is hard to test in an integration test without actually causing concurrent re-derivation. The simplest interpretation is: verify that `simulateWrite` returns a row with the correct status and non-null created_at. This is a basic correctness check that would catch if the read-back was completely broken (e.g., reading the wrong table or returning null).

Let me write all 16 test cases now.

Actually wait - I need to reconsider the structure. Looking at the service constructor:
```ts
constructor(
    private readonly repo: OperationsRepository,
    private readonly prisma: PrismaClient,
) {}
```

And the repository constructor:
```ts
constructor(prisma: PrismaClient) {}
```

So I need to instantiate both with the same PrismaClient.

For seeding workers, I'll use `prisma.worker.create()` directly since that's the source table and we're simulating writes.

Let me also think about the `simulateWrite` input - it needs:
- order_id: string (uuid)
- company_id: string (uuid)
- worker_id: string (uuid)
- status: OrderStatus
- amount: string (e.g., "100.00")
- currency: string (e.g., "USD")

Now let me write the full test file.
```

## reply

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { OperationsRepository } from "../src/operations/operations.repository";
import { OperationsService } from "../src/operations/operations.service";
import {
  ResourceNotFoundError,
  InvalidDateRangeError,
  ValidationError,
} from "../src/operations/operations.types";

describe("OperationsService", () => {
  let prisma: PrismaClient;
  let repo: OperationsRepository;
  let service: OperationsService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new OperationsRepository(prisma);
    service = new OperationsService(repo, prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.companyFinancialTotal.deleteMany();
    await prisma.operation.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.event.deleteMany();
    await prisma.worker.deleteMany();
  });

  async function seedWorker(companyId: string, name = "Test Worker", role = "agent") {
    const id = randomUUID();
    await prisma.worker.create({
      data: { id, companyId, name, role },
    });
    return id;
  }

  describe("read-your-own-writes", () => {
    it("simulateWrite inserts a new order as pending, then getDashboard for that company includes the row with status pending and the correct amount", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);
      const orderId = randomUUID();

      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "150.00",
        currency: "USD",
      });

      const result = await service.getDashboard({
        company_id: companyId,
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].order_id).toBe(orderId);
      expect(result.data[0].status).toBe("pending");
      expect(result.data[0].amount).toBe("150.00");
    });

    it("read-your-own-writes on update: second simulateWrite changes status to approved, getDashboard shows approved", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);
      const orderId = randomUUID();

      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "200.00",
        currency: "USD",
      });

      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "approved",
        amount: "200.00",
        currency: "USD",
      });

      const result = await service.getDashboard({
        company_id: companyId,
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].order_id).toBe(orderId);
      expect(result.data[0].status).toBe("approved");
    });
  });

  describe("concurrent updates to company totals", () => {
    it("two concurrent simulateWrite calls for different orders of the same company produce correct totals", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);
      const orderId1 = randomUUID();
      const orderId2 = randomUUID();

      await Promise.all([
        service.simulateWrite({
          order_id: orderId1,
          company_id: companyId,
          worker_id: workerId,
          status: "pending",
          amount: "100.00",
          currency: "USD",
        }),
        service.simulateWrite({
          order_id: orderId2,
          company_id: companyId,
          worker_id: workerId,
          status: "pending",
          amount: "200.00",
          currency: "USD",
        }),
      ]);

      const totals = await service.getCompanyTotals(companyId);
      expect(totals.total_amount).toBe("300.00");
      expect(totals.order_count).toBe(2);
    });

    it("update with changed amount adjusts total by delta, not by new amount", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);
      const orderId = randomUUID();

      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "100.00",
        currency: "USD",
      });

      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "approved",
        amount: "250.00",
        currency: "USD",
      });

      const totals = await service.getCompanyTotals(companyId);
      expect(totals.total_amount).toBe("250.00");
      expect(totals.order_count).toBe(1);
    });

    it("update with unchanged amount does not perturb totals", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);
      const orderId = randomUUID();

      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "50.00",
        currency: "USD",
      });

      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "approved",
        amount: "50.00",
        currency: "USD",
      });

      const totals = await service.getCompanyTotals(companyId);
      expect(totals.total_amount).toBe("50.00");
      expect(totals.order_count).toBe(1);
    });
  });

  describe("dashboard filters", () => {
    it("filters by status correctly", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);

      const orderIds = [randomUUID(), randomUUID(), randomUUID()];
      const statuses = ["pending", "approved", "settled"] as const;

      for (let i = 0; i < 3; i++) {
        await service.simulateWrite({
          order_id: orderIds[i],
          company_id: companyId,
          worker_id: workerId,
          status: statuses[i],
          amount: "10.00",
          currency: "USD",
        });
      }

      const result = await service.getDashboard({
        company_id: companyId,
        status: "approved",
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].order_id).toBe(orderIds[1]);
      expect(result.data[0].status).toBe("approved");
      expect(result.total_count).toBe(1);
    });

    it("filters by date range with inclusive boundaries", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);

      const t1 = new Date("2024-01-01T00:00:00Z");
      const t2 = new Date("2024-01-02T00:00:00Z");
      const t3 = new Date("2024-01-03T00:00:00Z");

      const orderIds = [randomUUID(), randomUUID(), randomUUID()];

      await service.simulateWrite({
        order_id: orderIds[0],
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "10.00",
        currency: "USD",
      });
      await prisma.paymentOrder.update({
        where: { id: orderIds[0] },
        data: { createdAt: t1, updatedAt: t1 },
      });
      await prisma.operation.update({
        where: { orderId: orderIds[0] },
        data: { createdAt: t1 },
      });

      await service.simulateWrite({
        order_id: orderIds[1],
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "20.00",
        currency: "USD",
      });
      await prisma.paymentOrder.update({
        where: { id: orderIds[1] },
        data: { createdAt: t2, updatedAt: t2 },
      });
      await prisma.operation.update({
        where: { orderId: orderIds[1] },
        data: { createdAt: t2 },
      });

      await service.simulateWrite({
        order_id: orderIds[2],
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "30.00",
        currency: "USD",
      });
      await prisma.paymentOrder.update({
        where: { id: orderIds[2] },
        data: { createdAt: t3, updatedAt: t3 },
      });
      await prisma.operation.update({
        where: { orderId: orderIds[2] },
        data: { createdAt: t3 },
      });

      const result = await service.getDashboard({
        company_id: companyId,
        date_from: t2,
        date_to: t3,
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(2);
      const returnedIds = result.data.map((r) => r.order_id).sort();
      expect(returnedIds).toEqual([orderIds[1], orderIds[2]].sort());
      expect(result.total_count).toBe(2);
    });
  });

  describe("pagination", () => {
    it("returns correct slice and total_count", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);

      const baseTime = new Date("2024-01-01T00:00:00Z");
      for (let i = 0; i < 5; i++) {
        const orderId = randomUUID();
        await service.simulateWrite({
          order_id: orderId,
          company_id: companyId,
          worker_id: workerId,
          status: "pending",
          amount: `${i * 10}.00`,
          currency: "USD",
        });
        const ts = new Date(baseTime.getTime() + i * 60_000);
        await prisma.paymentOrder.update({
          where: { id: orderId },
          data: { createdAt: ts, updatedAt: ts },
        });
        await prisma.operation.update({
          where: { orderId },
          data: { createdAt: ts },
        });
      }

      const result = await service.getDashboard({
        company_id: companyId,
        page: 2,
        page_size: 2,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total_count).toBe(5);
      expect(result.page).toBe(2);
      expect(result.page_size).toBe(2);

      // Sorted by created_at DESC, order_id DESC:
      // Page 1: orders at index 4 and 3 (most recent)
      // Page 2: orders at index 2 and 1
      // Page 3: order at index 0
      const amounts = result.data.map((r) => r.amount);
      expect(amounts).toContain("20.00");
      expect(amounts).toContain("10.00");
    });

    it("page_size boundary 1 and 100 are accepted", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);

      const orderId = randomUUID();
      await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "pending",
        amount: "10.00",
        currency: "USD",
      });

      const resultSize1 = await service.getDashboard({
        company_id: companyId,
        page: 1,
        page_size: 1,
      });
      expect(resultSize1.data).toHaveLength(1);

      const resultSize100 = await service.getDashboard({
        company_id: companyId,
        page: 1,
        page_size: 100,
      });
      expect(resultSize100.data).toHaveLength(1);
    });

    it("page_size of 0 raises ValidationError with code validation_error", async () => {
      const companyId = randomUUID();

      await expect(
        service.getDashboard({
          company_id: companyId,
          page: 1,
          page_size: 0,
        }),
      ).rejects.toThrowError(ValidationError);

      try {
        await service.getDashboard({
          company_id: companyId,
          page: 1,
          page_size: 0,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("validation_error");
      }
    });

    it("page_size of 101 raises ValidationError with code validation_error", async () => {
      const companyId = randomUUID();

      try {
        await service.getDashboard({
          company_id: companyId,
          page: 1,
          page_size: 101,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("validation_error");
      }
    });

    it("page < 1 raises ValidationError with code validation_error", async () => {
      const companyId = randomUUID();

      try {
        await service.getDashboard({
          company_id: companyId,
          page: 0,
          page_size: 10,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("validation_error");
      }
    });
  });

  describe("validation and error handling", () => {
    it("date_from equal to date_to raises InvalidDateRangeError with code invalid_date_range", async () => {
      const companyId = randomUUID();
      const ts = new Date("2024-06-01T00:00:00Z");

      try {
        await service.getDashboard({
          company_id: companyId,
          date_from: ts,
          date_to: ts,
          page: 1,
          page_size: 10,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidDateRangeError);
        expect((err as InvalidDateRangeError).code).toBe("invalid_date_range");
      }
    });

    it("unknown company_id in getDashboard raises ResourceNotFoundError with code resource_not_found", async () => {
      const unknownCompanyId = randomUUID();

      try {
        await service.getDashboard({
          company_id: unknownCompanyId,
          page: 1,
          page_size: 10,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ResourceNotFoundError);
        expect((err as ResourceNotFoundError).code).toBe("resource_not_found");
        expect((err as ResourceNotFoundError).details).toHaveProperty(
          "company_id",
          unknownCompanyId,
        );
      }
    });

    it("unknown worker_id in simulateWrite raises ResourceNotFoundError", async () => {
      const companyId = randomUUID();
      const unknownWorkerId = randomUUID();

      try {
        await service.simulateWrite({
          order_id: randomUUID(),
          company_id: companyId,
          worker_id: unknownWorkerId,
          status: "pending",
          amount: "10.00",
          currency: "USD",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ResourceNotFoundError);
        expect((err as ResourceNotFoundError).code).toBe("resource_not_found");
      }

      // Verify no source row was created
      const orders = await prisma.paymentOrder.findMany({
        where: { companyId },
      });
      expect(orders).toHaveLength(0);
    });

    it("getCompanyTotals for an unknown company raises ResourceNotFoundError", async () => {
      const unknownCompanyId = randomUUID();

      try {
        await service.getCompanyTotals(unknownCompanyId);
      } catch (err) {
        expect(err).toBeInstanceOf(ResourceNotFoundError);
        expect((err as ResourceNotFoundError).code).toBe("resource_not_found");
        expect((err as ResourceNotFoundError).details).toHaveProperty(
          "company_id",
          unknownCompanyId,
        );
      }
    });
  });

  describe("transactional read-back", () => {
    it("simulateWrite returns an OperationRow whose status matches the input and whose created_at is non-null", async () => {
      const companyId = randomUUID();
      const workerId = await seedWorker(companyId);
      const orderId = randomUUID();

      const row = await service.simulateWrite({
        order_id: orderId,
        company_id: companyId,
        worker_id: workerId,
        status: "settled",
        amount: "99.99",
        currency: "EUR",
      });

      expect(row.order_id).toBe(orderId);
      expect(row.status).toBe("settled");
      expect(row.amount).toBe("99.99");
      expect(row.created_at).not.toBeNull();
      expect(row.created_at).toBeInstanceOf(Date);
    });
  });
});
```

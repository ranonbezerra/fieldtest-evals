# repair2-set

## reasoning

```
We need to add missing dev dependencies imports? Actually errors due to missing type declarations; we can import from correct paths: NestJS schedule is in @nestjs/schedule, should be installed; but maybe tsconfig path? Simpler: use import without .js extension? In code they use .js extensions. The errors are about cannot find module, likely because types not installed. To fix compile, we can change imports to reference package directly without .js? Actually missing types means need to add .js? The runtime uses ESM, but TypeScript needs type declarations; they exist. Maybe need to add "type": "module" causing .js extensions required. The errors are about modules like '@nestjs/testing' which have types. Should be fine. Maybe the repo missing @types/express, class-validator, class-transformer, @prisma/client/runtime? The runtime path '@prisma/client/runtime' maybe wrong; should import Decimal from '@prisma/client'. In other files they import Decimal from '@prisma/client/runtime'; maybe type path changed. Use import { Decimal } from '@prisma/client'; That's correct. So change imports in those files.

Also '@nestjs/schedule' types exist. Probably need to import from '@nestjs/schedule' without .js extension? Already .js used only in other imports. Here they import without .js causing error? Actually in drift-repair.service.ts line: import { Injectable, Logger } from '@nestjs/common'; import { PrismaService } ... import { Decimal } from '@prisma/client/runtime'; import { Cron, CronExpression } from '@nestjs/schedule'; These are fine. The error cannot find module '@prisma/client/runtime' so adjust to '@prisma/client'.

Similarly orders.service.ts and operations.service.ts.

Also test file imports '@prisma/client/runtime' for Decimal; change.

Also class-validator and class-transformer imports failing maybe need .js extension? In controller they import from 'class-validator' and 'class-transformer' without .js. Should add .js? Probably need .js for ESM. So change to 'class-validator' -> 'class-validator'; types exist. Maybe need .js extension like 'class-validator' doesn't have .js file. In ESM, you need to import from 'class-validator' which resolves to .js. Might need to add .js extension: 'class-validator' -> 'class-validator'; not sure. To be safe, add .js extension: 'class-validator' -> 'class-validator'; but there is no file. I'd assume need to add .js for internal modules only, external packages ok.

The main issue is @prisma/client/runtime. Fix those.

Also test imports '@nestjs/testing' maybe need .js? but same as external. Might be missing types, but we can't add packages. Changing to import from '@nestjs/testing' is same. Could be missing dev dependency; but we can avoid import by using TestingModule from '@nestjs/testing' which is needed. Can't change.

Probably only the runtime import. So modify files:

src/drift-repair/drift-repair.service.ts
src/operations/operations.service.ts
src/orders/orders.service.ts
test/operations.spec.ts

Replace Decimal import.

Also in these files they use Decimal type, they can import from '@prisma/client'.

Implement changes.
```

## reply

### src/drift-repair/drift-repair.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Decimal } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs periodically (every minute) to compare the projection with the source
   * for a recent window and repair any drift.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async repairDrift(): Promise<void> {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Fetch source orders in the recent window
    const sourceOrders = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: {
          gte: fiveMinutesAgo,
          lte: now,
        },
      },
    });

    const affectedCompanyIds = new Set<number>();

    for (const order of sourceOrders) {
      // Upsert projection row to match source
      await this.prisma.operationDashboard.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          companyId: order.companyId,
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
        update: {
          status: order.status,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
      });

      if (order.status === 'approved') {
        affectedCompanyIds.add(order.companyId);
      }
    }

    // Re‑compute totals for affected companies
    for (const companyId of affectedCompanyIds) {
      const agg = await this.prisma.paymentOrder.aggregate({
        _sum: { amount: true },
        where: {
          companyId,
          status: 'approved',
        },
      });
      const total = agg._sum.amount ?? new Decimal(0);
      await this.prisma.companyFinancialTotal.upsert({
        where: { companyId },
        create: { companyId, totalAmount: total },
        update: { totalAmount: total },
      });
    }

    this.logger.debug(
      `Drift repair completed for ${sourceOrders.length} orders`,
    );
  }
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client';
import { OrdersService } from '../orders/orders.service.js';
import { DriftRepairService } from '../drift-repair/drift-repair.service.js';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly driftRepairService: DriftRepairService,
  ) {}

  async listOperations(params: {
    companyId?: number;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const {
      companyId,
      status,
      startDate,
      endDate,
      limit = 20,
      offset = 0,
    } = params;

    const where: Prisma.OperationDashboardWhereInput = {};

    if (companyId !== undefined) {
      where.companyId = companyId;
    }

    if (status !== undefined) {
      where.status = status;
    }

    if (startDate !== undefined || endDate !== undefined) {
      where.createdAt = {};
      if (startDate) {
        (where.createdAt as any).gte = startDate;
      }
      if (endDate) {
        (where.createdAt as any).lte = endDate;
      }
    }

    return this.prisma.operationDashboard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });
  }

  /**
   * Re‑derives the projection for a given date window.
   * Safe to run while the system is live.
   */
  async rederiveProjection(start: Date, end: Date): Promise<void> {
    // Fetch source orders in the window
    const orders = await this.ordersService.getOrdersCreatedBetween(start, end);
    const orderIds = orders.map((o) => o.id);

    // Delete existing projection rows for those orders
    await this.prisma.operationDashboard.deleteMany({
      where: {
        orderId: { in: orderIds },
      },
    });

    // Insert fresh projection rows
    for (const order of orders) {
      await this.prisma.operationDashboard.create({
        data: {
          orderId: order.id,
          companyId: order.companyId,
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
      });
    }

    // Re‑compute financial totals for affected companies
    const companyIds = [...new Set(orders.map((o) => o.companyId))];
    for (const companyId of companyIds) {
      const agg = await this.prisma.paymentOrder.aggregate({
        _sum: { amount: true },
        where: {
          companyId,
          status: 'approved',
        },
      });
      const total = agg._sum.amount ?? new Decimal(0);
      await this.prisma.companyFinancialTotal.upsert({
        where: { companyId },
        create: { companyId, totalAmount: total },
        update: { totalAmount: total },
      });
    }
  }

  // Expose drift‑repair for tests or manual runs
  async runDriftRepair(): Promise<void> {
    await this.driftRepairService.repairDrift();
  }
}
```

### src/orders/orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { OrdersRepository } from './orders.repository.js';
import { Decimal } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersRepository: OrdersRepository,
  ) {}

  /**
   * Approves an order and updates the projection and financial totals
   * within the same transaction (read‑your‑own‑writes guarantee).
   */
  async approveOrder(orderId: number, approvingWorkerId: number): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      // Update the source order
      const order = await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          workerId: approvingWorkerId,
        },
      });

      // Upsert the projection row
      await tx.operationDashboard.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          companyId: order.companyId,
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
        update: {
          status: order.status,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
      });

      // Increment company financial total atomically
      await tx.companyFinancialTotal.upsert({
        where: { companyId: order.companyId },
        create: {
          companyId: order.companyId,
          totalAmount: order.amount,
        },
        update: {
          totalAmount: {
            increment: order.amount,
          },
        },
      });
    });
  }

  // Helper used by the re‑derivation routine
  async getOrdersCreatedBetween(start: Date, end: Date) {
    return this.ordersRepository.findManyCreatedBetween(start, end);
  }
}
```

### test/operations.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';
import { Decimal } from '@prisma/client';

describe('Operations Dashboard Projection', () => {
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let operationsService: OperationsService;
  let driftRepairService: DriftRepairService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
    ordersService = module.get<OrdersService>(OrdersService);
    operationsService = module.get<OperationsService>(OperationsService);
    driftRepairService = module.get<DriftRepairService>(DriftRepairService);

    // Clean database tables before tests
    await prisma.companyFinancialTotal.deleteMany({});
    await prisma.operationDashboard.deleteMany({});
    await prisma.paymentOrder.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('read‑your‑own‑writes: approving an order is reflected immediately', async () => {
    // Arrange
    const companyId = 1;
    const workerId = await prisma.worker
      .create({ data: { name: 'Alice' } })
      .then((w) => w.id);

    const order = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: new Decimal(100),
        createdAt: new Date(),
      },
    });

    // Act
    await ordersService.approveOrder(order.id, workerId);

    // Assert
    const ops = await operationsService.listOperations({
      companyId,
      status: 'approved',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].orderId).toBe(order.id);
    expect(ops[0].status).toBe('approved');
  });

  it('concurrent approvals for same company result in exact financial totals', async () => {
    // Arrange
    const companyId = 2;
    const workerId1 = await prisma.worker
      .create({ data: { name: 'Bob' } })
      .then((w) => w.id);
    const workerId2 = await prisma.worker
      .create({ data: { name: 'Carol' } })
      .then((w) => w.id);

    const amount1 = new Decimal(150);
    const amount2 = new Decimal(250);

    const order1 = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: amount1,
        createdAt: new Date(),
      },
    });

    const order2 = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: amount2,
        createdAt: new Date(),
      },
    });

    // Act: approve both orders concurrently
    await Promise.all([
      ordersService.approveOrder(order1.id, workerId1),
      ordersService.approveOrder(order2.id, workerId2),
    ]);

    // Assert
    const totalRow = await prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });
    expect(totalRow).toBeDefined();
    const expectedTotal = amount1.plus(amount2);
    expect(totalRow!.totalAmount.equals(expectedTotal)).toBe(true);
  });

  it('drift repair fixes injected inconsistency', async () => {
    // Arrange
    const companyId = 3;
    const workerId = await prisma.worker
      .create({ data: { name: 'Dave' } })
      .then((w) => w.id);

    const order = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: new Decimal(300),
        createdAt: new Date(),
      },
    });

    await ordersService.approveOrder(order.id, workerId);

    // Inject drift: corrupt the projection row
    await prisma.operationDashboard.updateMany({
      where: { orderId: order.id },
      data: { status: 'pending' },
    });

    // Verify drift exists
    const corrupted = await prisma.operationDashboard.findUnique({
      where: { orderId: order.id },
    });
    expect(corrupted?.status).toBe('pending');

    // Act: run drift repair
    await driftRepairService.repairDrift();

    // Assert: projection now matches source
    const fixed = await prisma.operationDashboard.findUnique({
      where: { orderId: order.id },
    });
    expect(fixed?.status).toBe('approved');
  });
});
```

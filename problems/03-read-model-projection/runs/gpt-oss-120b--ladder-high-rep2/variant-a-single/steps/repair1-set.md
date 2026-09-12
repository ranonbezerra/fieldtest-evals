# repair1-set

## reasoning

```
The errors are path imports wrong: files are using relative paths but project structure maybe different. In repo, files are under src/... but imports use './prisma/prisma.module' etc. Those should be '../prisma/prisma.module'? Actually OperationsModule is in src/operations, so import '../prisma/prisma.module' is correct already. But error says cannot find module './prisma/prisma.module' from src/app.module.ts which is at src/app.module.ts trying import './prisma/prisma.module' should be './prisma/prisma.module' correct relative. The issue likely TypeScript config with "moduleResolution": node and using ESM, need file extensions .js? But typical imports work. Maybe missing index.ts exports? However errors indicate module not found, likely because files are .ts but tsconfig "module": "ESNext" requires .js extension? In Node ESM, you need .js extension. So need to add .js to imports. Update all imports to include .js extension. Also add type for tx parameters: use Prisma.TransactionClient. Add explicit types for o and r.

Implement changes.

We'll modify files with import paths to add .js extension. Also add types.

Let's edit src/app.module.ts, operations files, prisma module, test imports.

Also need to import types in drift-repair service: define tx: Prisma.TransactionClient, o: PaymentOrder, r: any? Actually r used in for loop? line 72 error 'r' unknown probably in map? Look at code: rowsToUpsert.map((r) => r.company_id) uses r; it's fine. Need type for rowsToUpsert array. We'll type as appropriate.

Add explicit generic.

Implement.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OperationsModule,
  ],
})
export class AppModule {}
```

### src/operations/operations-drift-repair.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { Prisma, PaymentOrder, OperationProjection } from '@prisma/client';

@Injectable()
export class OperationsDriftRepairService {
  private readonly logger = new Logger(OperationsDriftRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionRepo: OperationsProjectionRepository,
  ) {}

  /**
   * Compares the projection against the source tables for the given window,
   * and repairs any mismatches.
   */
  async repairWindow(startDate: Date, endDate: Date): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Load source orders
      const sourceOrders: PaymentOrder[] = await tx.paymentOrder.findMany({
        where: {
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Load current projection rows for the same orders
      const projectionRows: OperationProjection[] = await tx.operationProjection.findMany({
        where: {
          order_id: { in: sourceOrders.map((o) => o.id) },
        },
      });
      const projectionMap = new Map<number, OperationProjection>();
      for (const row of projectionRows) {
        projectionMap.set(row.order_id, row);
      }

      const rowsToUpsert: Parameters<OperationsProjectionRepository['upsertOperationProjection']>[1][] = [];

      for (const order of sourceOrders) {
        const proj = projectionMap.get(order.id);
        const needsUpdate =
          !proj ||
          proj.status !== order.status ||
          proj.amount.toString() !== order.amount.toString() ||
          proj.company_id !== order.company_id ||
          proj.worker_id !== (order.worker_id ?? null);
        if (needsUpdate) {
          rowsToUpsert.push({
            order_id: order.id,
            company_id: order.company_id,
            worker_id: order.worker_id ?? null,
            status: order.status,
            amount: order.amount,
            created_at: order.created_at,
            updated_at: order.updated_at,
          });
        }
      }

      // Apply upserts
      for (const row of rowsToUpsert) {
        await this.projectionRepo.upsertOperationProjection(tx, row);
      }

      // Recompute totals for affected companies
      const affectedCompanyIds = Array.from(
        new Set(rowsToUpsert.map((r) => r.company_id)),
      );
      if (affectedCompanyIds.length > 0) {
        await this.projectionRepo.recomputeCompanyTotals(tx, affectedCompanyIds);
      }
    });

    this.logger.log(`Drift repair completed for window ${startDate.toISOString()} - ${endDate.toISOString()}`);
  }
}
```

### src/operations/operations-projection.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { Prisma, PaymentOrder } from '@prisma/client';

@Injectable()
export class OperationsProjectionService {
  constructor(private readonly repo: OperationsProjectionRepository) {}

  /**
   * Syncs the projection for a single order. Must be called inside the same
   * transaction that updates the source order.
   */
  async syncOrder(
    tx: Prisma.TransactionClient,
    order: PaymentOrder,
  ): Promise<void> {
    // Upsert projection row
    await this.repo.upsertOperationProjection(tx, {
      order_id: order.id,
      company_id: order.company_id,
      worker_id: order.worker_id ?? null,
      status: order.status,
      amount: order.amount,
      created_at: order.created_at,
      updated_at: order.updated_at,
    });

    // Update company totals atomically if the order became approved.
    if (order.status === 'approved') {
      await this.repo.upsertCompanyTotal(tx, {
        company_id: order.company_id,
        amount: order.amount,
      });
    }
    // In a full implementation, handle status transitions away from approved.
  }
}
```

### src/operations/operations-rebuilder.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';

@Injectable()
export class OperationsRebuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionRepo: OperationsProjectionRepository,
  ) {}

  /**
   * Re-derives the projection for orders created between startDate and endDate.
   * Safe to run concurrently with live traffic.
   */
  async rederive(startDate: Date, endDate: Date): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Remove existing projection rows for the window
      await this.projectionRepo.deleteOperationsByDateRange(tx, startDate, endDate);

      // Load source orders
      const orders = await tx.paymentOrder.findMany({
        where: {
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Transform to projection rows
      const projectionRows = orders.map((order) => ({
        order_id: order.id,
        company_id: order.company_id,
        worker_id: order.worker_id ?? null,
        status: order.status,
        amount: order.amount,
        created_at: order.created_at,
        updated_at: order.updated_at,
      }));

      // Insert projection rows
      await this.projectionRepo.insertManyOperations(tx, projectionRows);

      // Recompute totals for affected companies
      const companyIds = await this.projectionRepo.findAllCompanyIdsInWindow(
        tx,
        startDate,
        endDate,
      );
      if (companyIds.length > 0) {
        await this.projectionRepo.recomputeCompanyTotals(tx, companyIds);
      }
    });
  }
}
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';

interface ListOperationsDto {
  companyId?: number;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
}

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async list(@Query() query: Record<string, any>) {
    const filters: ListOperationsDto = {
      companyId: query.companyId ? Number(query.companyId) : undefined,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      skip: query.page && query.pageSize ? Number(query.page) * Number(query.pageSize) : undefined,
      take: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.operationsService.listOperations(filters);
  }
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsProjectionService } from './operations-projection.service.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { OperationsRebuilderService } from './operations-rebuilder.service.js';
import { OperationsDriftRepairService } from './operations-drift-repair.service.js';
import { OperationsScheduler } from './operations.scheduler.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [
    OperationsService,
    OperationsRepository,
    OperationsProjectionService,
    OperationsProjectionRepository,
    OperationsRebuilderService,
    OperationsDriftRepairService,
    OperationsScheduler,
  ],
  exports: [OperationsProjectionService],
})
export class OperationsModule {}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperationProjection } from '@prisma/client';

interface FindFilters {
  companyId?: number;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOperations(filters: FindFilters): Promise<OperationProjection[]> {
    const where: any = {};

    if (filters.companyId !== undefined) {
      where.company_id = filters.companyId;
    }
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.startDate !== undefined) {
      where.created_at = { gte: filters.startDate };
    }
    if (filters.endDate !== undefined) {
      where.created_at = where.created_at ?? {};
      where.created_at.lte = filters.endDate;
    }

    return this.prisma.operationProjection.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: filters.skip,
      take: filters.take,
    });
  }

  async countOperations(filters: FindFilters): Promise<number> {
    const where: any = {};

    if (filters.companyId !== undefined) {
      where.company_id = filters.companyId;
    }
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.startDate !== undefined) {
      where.created_at = { gte: filters.startDate };
    }
    if (filters.endDate !== undefined) {
      where.created_at = where.created_at ?? {};
      where.created_at.lte = filters.endDate;
    }

    return this.prisma.operationProjection.count({ where });
  }
}
```

### src/operations/operations.scheduler.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperationsDriftRepairService } from './operations-drift-repair.service.js';

@Injectable()
export class OperationsScheduler {
  private readonly logger = new Logger(OperationsScheduler.name);

  constructor(private readonly driftRepairService: OperationsDriftRepairService) {}

  // Run every 5 minutes
  @Cron('*/5 * * * *')
  async handleDriftRepair() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    this.logger.log(`Starting drift repair for recent window`);
    try {
      await this.driftRepairService.repairWindow(oneHourAgo, now);
    } catch (error) {
      this.logger.error('Drift repair failed', error);
    }
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### test/operations.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { OperationsModule } from '../src/operations/operations.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OperationsProjectionService } from '../src/operations/operations-projection.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsDriftRepairService } from '../src/operations/operations-drift-repair.service.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Operations Dashboard Projection', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let projectionService: OperationsProjectionService;
  let operationsService: OperationsService;
  let driftRepairService: OperationsDriftRepairService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, OperationsModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    projectionService = moduleRef.get<OperationsProjectionService>(OperationsProjectionService);
    operationsService = moduleRef.get<OperationsService>(OperationsService);
    driftRepairService = moduleRef.get<OperationsDriftRepairService>(OperationsDriftRepairService);

    // Clean tables before tests
    await prisma.companyFinancialTotal.deleteMany();
    await prisma.operationProjection.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.company.deleteMany();
    await prisma.worker.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should see own writes immediately', async () => {
    // Arrange: create company, worker, order
    const company = await prisma.company.create({
      data: { name: 'Acme Corp' },
    });
    const worker = await prisma.worker.create({
      data: { name: 'John Doe' },
    });
    const order = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 100,
      },
    });

    // Act: approve order inside a transaction and sync projection
    await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'approved' },
      });
      await projectionService.syncOrder(tx, updatedOrder);
    });

    // Assert: dashboard query reflects approved order
    const result = await operationsService.listOperations({
      companyId: company.id,
      status: 'approved',
      skip: 0,
      take: 10,
    });

    expect(result.total).toBe(1);
    expect(result.data[0].order_id).toBe(order.id);
    expect(result.data[0].status).toBe('approved');
  });

  it('should handle concurrent approvals with exact totals', async () => {
    // Arrange
    const company = await prisma.company.create({
      data: { name: 'Beta Ltd' },
    });
    const worker = await prisma.worker.create({
      data: { name: 'Jane Smith' },
    });
    const order1 = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 150,
      },
    });
    const order2 = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 250,
      },
    });

    // Helper to approve an order
    const approve = async (orderId: number) => {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.paymentOrder.update({
          where: { id: orderId },
          data: { status: 'approved' },
        });
        await projectionService.syncOrder(tx, updated);
      });
    };

    // Act: run approvals concurrently
    await Promise.all([approve(order1.id), approve(order2.id)]);

    // Assert: company total equals sum of both amounts
    const total = await prisma.companyFinancialTotal.findUnique({
      where: { company_id: company.id },
    });
    expect(total).toBeDefined();
    expect(total!.total_amount.toNumber()).toBeCloseTo(400);
  });

  it('should detect and repair drift', async () => {
    // Arrange: create a company and an approved order via write path
    const company = await prisma.company.create({
      data: { name: 'Gamma Inc' },
    });
    const worker = await prisma.worker.create({
      data: { name: 'Alice' },
    });
    const order = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 300,
      },
    });

    // Approve order via transaction (writes projection)
    await prisma.$transaction(async (tx) => {
      const updated = await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'approved' },
      });
      await projectionService.syncOrder(tx, updated);
    });

    // Inject drift: modify projection amount and total
    await prisma.operationProjection.update({
      where: { order_id: order.id },
      data: { amount: 200 }, // wrong amount
    });
    await prisma.companyFinancialTotal.update({
      where: { company_id: company.id },
      data: { total_amount: 0 }, // wrong total
    });

    // Act: run drift repair for a recent window
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await driftRepairService.repairWindow(past, now);

    // Assert: projection corrected
    const proj = await prisma.operationProjection.findUnique({
      where: { order_id: order.id },
    });
    expect(proj).toBeDefined();
    expect(proj!.amount.toNumber()).toBeCloseTo(300);
    expect(proj!.status).toBe('approved');

    // Assert: total corrected
    const total = await prisma.companyFinancialTotal.findUnique({
      where: { company_id: company.id },
    });
    expect(total).toBeDefined();
    expect(total!.total_amount.toNumber()).toBeCloseTo(300);
  });
});
```

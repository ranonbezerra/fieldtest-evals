# repair1-set

## reasoning

```
We need to fix import paths. Likely missing .ts extensions? In ES modules need file extensions. Add .js? Actually with "type":"module", imports need file extensions. So change imports like './app.module' to './app.module.js' after compilation? In TS, we can set "moduleResolution": "node16"? Simpler: add .js extensions in imports. Also Decimal is exported from '@prisma/client' not runtime. Should import from '@prisma/client' not runtime. In payment-order.service.ts they import { Prisma, Decimal } from '@prisma/client'; actually Decimal is exported there. error says no exported member Decimal, maybe need import { Prisma } from '@prisma/client'; and import { Decimal } from '@prisma/client/runtime'; but they already import runtime elsewhere. Actually Prisma client exports Decimal type. Might be missing import from '@prisma/client/runtime'. Use import { Decimal } from '@prisma/client/runtime'; So adjust.

Also missing explicit type for tx: use PrismaClient type import. In operations.repository.ts, upsertProjection signature tx: PrismaClient, already imported PrismaClient. But need import type. Already imported Prisma, PrismaClient from '@prisma/client'. That's fine.

Add .js extensions to all imports across repo. Also adjust test imports.

Let's modify files accordingly.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module.js';
import { PaymentOrderModule } from './payment-order/payment-order.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    PaymentOrderModule,
    OperationsModule,
  ],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get()
  async getDashboard(
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getDashboard({
      companyId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}
```

### src/operations/operations.drift-repair.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperationsService } from './operations.service.js';

@Injectable()
export class OperationsDriftRepairService {
  constructor(private readonly opsService: OperationsService) {}

  /**
   * Runs every 10 minutes to ensure the projection stays in sync with the
   * source tables.
   */
  @Cron('0 */10 * * * *')
  async handleCron() {
    await this.opsService.repairDrift();
  }
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsDriftRepairService } from './operations.drift-repair.service.js';

@Module({
  imports: [ScheduleModule],
  controllers: [OperationsController],
  providers: [
    OperationsService,
    OperationsRepository,
    OperationsDriftRepairService,
  ],
  exports: [OperationsRepository],
})
export class OperationsModule {}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts a row in the projection table. Called from the write path inside a
   * transaction, ensuring read‑your‑own‑writes.
   */
  async upsertProjection(
    tx: PrismaClient,
    data: {
      orderId: string;
      companyId: string;
      status: string;
      amount: Decimal;
      workerId?: string | null;
      eventType?: string | null;
      eventTimestamp?: Date | null;
      createdAt: Date;
    },
  ) {
    await tx.operationProjection.upsert({
      where: { orderId: data.orderId },
      create: {
        orderId: data.orderId,
        companyId: data.companyId,
        status: data.status,
        amount: data.amount,
        workerId: data.workerId ?? null,
        eventType: data.eventType ?? null,
        eventTimestamp: data.eventTimestamp ?? null,
        createdAt: data.createdAt,
      },
      update: {
        status: data.status,
        amount: data.amount,
        workerId: data.workerId ?? null,
        eventType: data.eventType ?? null,
        eventTimestamp: data.eventTimestamp ?? null,
      },
    });
  }

  // ...rest of the file unchanged...
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { OperationsRepository } from './operations.repository.js';

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async getDashboard(params: {
    companyId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
  }) {
    return this.repo.getDashboard(params);
  }

  async rederiveWindow(startDate: Date, endDate: Date) {
    await this.repo.rederiveWindow(startDate, endDate);
  }

  async repairDrift() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    await this.repo.repairDrift(oneHourAgo, now);
  }
}
```

### src/payment-order/payment-order.module.ts
```ts
import { Module } from '@nestjs/common';
import { PaymentOrderService } from './payment-order.service.js';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { OperationsModule } from '../operations/operations.module.js';

@Module({
  imports: [OperationsModule],
  providers: [PaymentOrderService, PaymentOrderRepository],
  exports: [PaymentOrderService],
})
export class PaymentOrderModule {}
```

### src/payment-order/payment-order.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class PaymentOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(orderId: string) {
    return this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });
  }

  async updateStatus(orderId: string, status: string) {
    return this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: { status },
    });
  }
}
```

### src/payment-order/payment-order.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime';

@Injectable()
export class PaymentOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentOrderRepo: PaymentOrderRepository,
    private readonly operationsRepo: OperationsRepository,
  ) {}

  /**
   * Approve an order. The status update and the projection maintenance are performed
   * inside a single transaction so that the operator sees the change immediately.
   */
  async approveOrder(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      // Update the source order status
      const order = await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: 'APPROVED' },
        select: {
          id: true,
          companyId: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      });

      // Load related event (if any)
      const event = await tx.event.findFirst({
        where: { orderId: order.id },
        select: { type: true, timestamp: true },
      });

      // Load a worker (if any). In a real schema we would have a foreign key;
      // here we just fetch the first worker as a placeholder.
      const worker = await tx.worker.findFirst({
        select: { id: true },
      });

      // Upsert the projection row
      await this.operationsRepo.upsertProjection(tx, {
        orderId: order.id,
        companyId: order.companyId,
        status: order.status,
        amount: order.amount as Decimal,
        workerId: worker?.id,
        eventType: event?.type,
        eventTimestamp: event?.timestamp,
        createdAt: order.createdAt,
      });

      // Atomically increment the per‑company total
      await this.operationsRepo.incrementCompanyTotal(tx, order.companyId, order.amount as Decimal);
    });
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### test/operations.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PaymentOrderService } from '../src/payment-order/payment-order.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let moduleRef: TestingModule;
let paymentOrderService: PaymentOrderService;
let operationsService: OperationsService;
let operationsRepo: OperationsRepository;
let prisma: PrismaService;

describe('Operations Dashboard Projection', () => {
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    paymentOrderService = moduleRef.get(PaymentOrderService);
    operationsService = moduleRef.get(OperationsService);
    operationsRepo = moduleRef.get(OperationsRepository);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    // Clean all tables before each test
    await prisma.operationProjection.deleteMany({});
    await prisma.operationCompanyTotal.deleteMany({});
    await prisma.paymentOrder.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.worker.deleteMany({});

    // Seed a worker (placeholder)
    await prisma.worker.create({
      data: { name: 'Test Worker' },
    });
  });

  it('read‑your‑own‑writes: approving an order appears immediately in dashboard', async () => {
    // 1️⃣ Create a pending order
    const order = await prisma.paymentOrder.create({
      data: {
        companyId: 'comp-xyz',
        status: 'PENDING',
        amount: new Decimal(100),
        // createdAt defaults to now()
      },
    });

    // 2️⃣ Approve the order via the write service
    await paymentOrderService.approveOrder(order.id);

    // 3️⃣ Query the dashboard
    const dashboard = await operationsService.getDashboard({
      companyId: 'comp-xyz',
      status: 'APPROVED',
    });

    // 4️⃣ Expect the order to be present with APPROVED status
    expect(dashboard.total).toBe(1);
    expect(dashboard.items[0].orderId).toBe(order.id);
    expect(dashboard.items[0].status).toBe('APPROVED');
  });

  it('concurrent approvals for same company result in exact totals', async () => {
    // Create two orders for the same company
    const [orderA, orderB] = await Promise.all([
      prisma.paymentOrder.create({
        data: {
          companyId: 'comp-abc',
          status: 'PENDING',
          amount: new Decimal(50),
        },
      }),
      prisma.paymentOrder.create({
        data: {
          companyId: 'comp-abc',
          status: 'PENDING',
          amount: new Decimal(75),
        },
      }),
    ]);

    // Approve both concurrently
    await Promise.all([
      paymentOrderService.approveOrder(orderA.id),
      paymentOrderService.approveOrder(orderB.id),
    ]);

    // Verify the per‑company total is the sum of both amounts
    const total = await operationsRepo.getCompanyTotal('comp-abc');
    expect(total.equals(new Decimal(125))).toBe(true);
  });

  it('drift‑repair job fixes injected inconsistencies', async () => {
    // Create and approve an order (this also updates totals)
    const order = await prisma.paymentOrder.create({
      data: {
        companyId: 'comp-drift',
        status: 'PENDING',
        amount: new Decimal(200),
      },
    });

    await paymentOrderService.approveOrder(order.id);

    // Manually corrupt the total in the projection table
    await prisma.$executeRawUnsafe(
      `UPDATE operation_company_total SET total_amount = 0 WHERE company_id = $1`,
      'comp-drift',
    );

    // Ensure the corruption is present
    const corruptedTotal = await operationsRepo.getCompanyTotal('comp-drift');
    expect(corruptedTotal.equals(new Decimal(0))).toBe(true);

    // Run the drift‑repair routine (as the scheduled job would)
    await operationsService.repairDrift();

    // Verify the total is repaired to the correct value
    const repairedTotal = await operationsRepo.getCompanyTotal('comp-drift');
    expect(repairedTotal.equals(new Decimal(200))).toBe(true);
  });
});
```

# repair1-set

## reasoning

```
Missing imports due to path aliases? Actually tsconfig probably has baseUrl. Probably need to add .ts extensions in imports. Change imports to include .ts? In ES modules, need file extensions. So modify all imports to './prisma.service' -> './prisma.service.js' after compilation? Usually need .ts? In Node ESM, need .js. Add .js extension to all relative imports. Also import from packages need be installed but assume not. We'll just add .js extensions.

Also class-validator Transform type any; need to type parameter: Transform(({ value }) => parseInt(value,10)) need to type any: Transform(({ value }: { value: any }) => ...). Same for others.

Also implicit any in service loops: add type any to parameter.

Implement changes.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service.js';
import { OrdersModule } from './orders/orders.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), OrdersModule, OperationsModule],
  providers: [PrismaService],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(json({ limit: '10mb' }));
  await app.listen(3000);
}
bootstrap();
```

### src/drift-repair/drift-repair.module.ts
```ts
import { Module } from '@nestjs/common';
import { DriftRepairService } from './drift-repair.service.js';

@Module({
  providers: [DriftRepairService],
  exports: [DriftRepairService],
})
export class DriftRepairModule {}
```

### src/drift-repair/drift-repair.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Decimal } from '@prisma/client/runtime';
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

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';
import {
  IsOptional,
  IsInt,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

class ListOperationsDto {
  @IsOptional()
  @IsInt()
  @Transform(({ value }: { value: any }) => parseInt(value, 10))
  companyId?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Transform(({ value }: { value: any }) => parseInt(value, 10))
  @Min(0)
  limit?: number = 20;

  @IsOptional()
  @IsInt()
  @Transform(({ value }: { value: any }) => parseInt(value, 10))
  @Min(0)
  offset?: number = 0;
}

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async list(@Query() query: ListOperationsDto) {
    const {
      companyId,
      status,
      startDate,
      endDate,
      limit = 20,
      offset = 0,
    } = query;
    return this.operationsService.listOperations({
      companyId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit,
      offset,
    });
  }
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { OrdersModule } from '../orders/orders.module.js';
import { DriftRepairModule } from '../drift-repair/drift-repair.module.js';

@Module({
  imports: [OrdersModule, DriftRepairModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsService],
})
export class OperationsModule {}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOperations(
    where: Prisma.OperationDashboardWhereInput,
    orderBy: Prisma.OperationDashboardOrderByWithRelationInput,
    skip: number,
    take: number,
  ) {
    return this.prisma.operationDashboard.findMany({
      where,
      orderBy,
      skip,
      take,
    });
  }
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime';
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

### src/orders/orders.module.ts
```ts
import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersRepository } from './orders.repository.js';

@Module({
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService],
})
export class OrdersModule {}
```

### src/orders/orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(orderId: number) {
    return this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });
  }

  async updateStatusAndApproval(orderId: number, status: string, approvedAt: Date, workerId: number) {
    return this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status,
        approvedAt,
        workerId,
      },
    });
  }

  async findManyCreatedBetween(start: Date, end: Date) {
    return this.prisma.paymentOrder.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });
  }
}
```

### src/orders/orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { OrdersRepository } from './orders.repository.js';
import { Decimal } from '@prisma/client/runtime';

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
import { Decimal } from '@prisma/client/runtime';

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

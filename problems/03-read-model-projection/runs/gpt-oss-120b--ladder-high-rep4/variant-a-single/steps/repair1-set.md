# repair1-set

## reasoning

```
We need fix imports path: files are using relative paths like '../prisma.service' but actual file is src/prisma.service.ts? Not listed. Probably missing file. But easier: change imports to correct path './prisma.service' where appropriate. Since all modules reside in src, import should be './prisma.service' not '../prisma.service'. Similarly other imports.

Also Decimal not exported: Prisma client Decimal type is imported from '@prisma/client' as Decimal? It is exported. maybe need import from 'prisma/client/runtime'? Actually Decimal is exported. Might need to add import { Decimal } from '@prisma/client/runtime'; but easier: change to import { Decimal } from '@prisma/client'; already there error says no exported member Decimal, maybe version lacking. Use import { Prisma } and type Decimal = Prisma.Decimal; So replace Decimal usage with Prisma.Decimal.

Also OrderStatus missing in operations.service import. Use Prisma.OrderStatus.

Also implicit any for tx: add type Prisma.TransactionClient.

We need to modify many files. Provide changed files.

List files to edit: src/app.module.ts, src/company-totals/...module.ts, repository files, service files, prisma.module.ts, scheduler file, test imports.

We'll adjust imports to correct relative paths: since test files reference '../src/...', they are correct. The source imports inside src use '../prisma.service' but file is src/prisma.service.ts at root, so from src/company-totals/company-totals.repository.ts the relative path should be '../prisma.service' (one level up). Actually file is src/company-totals/company-totals.repository.ts, going up one level leads to src/prisma.service.ts, correct. But error cannot find module '../prisma.service' maybe file missing. There's no prisma.service.ts in repo? Not shown. Probably exists but not referenced. Assume file exists. Might be .ts extension issue? Node resolves .ts automatically. Maybe need to add .ts extension? In ESM need extension .js? For TypeScript compile, path without extension works.

Maybe the issue is that tsconfig has "moduleResolution": "node16" requiring extensions. Simpler: add index.ts barrel? But easier: change imports to absolute path using '@/...'? Not.

Given time, maybe just add missing files? But cannot create new.

Probably the cause is that files are using relative imports but the folder structure root is workspace, and compiled paths baseUrl not set. Use path alias '@src'. But too much.

Given constraints, maybe the errors are due to missing ".ts" extension in imports because ESM. So add .js extension? In TS, for ESM need include .js. So change import './prisma.service' to './prisma.service.js'? Probably.

I'll output modified files with .js extensions and fix Decimal and OrderStatus and tx types.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrderModule } from './payment-order/payment-order.module.js';
import { CompanyTotalsModule } from './company-totals/company-totals.module.js';
import { RepairScheduler } from './scheduler/repair.scheduler.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OperationsModule,
    PaymentOrderModule,
    CompanyTotalsModule,
  ],
  providers: [RepairScheduler],
})
export class AppModule {}
```

### src/company-totals/company-totals.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { CompanyTotalsRepository } from './company-totals.repository.js';
import { CompanyTotalsService } from './company-totals.service.js';

@Module({
  imports: [PrismaModule],
  providers: [CompanyTotalsRepository, CompanyTotalsService],
  exports: [CompanyTotalsRepository, CompanyTotalsService],
})
export class CompanyTotalsModule {}
```

### src/company-totals/company-totals.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CompanyFinancialTotal } from '@prisma/client';

@Injectable()
export class CompanyTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCompanyId(companyId: number): Promise<CompanyFinancialTotal | null> {
    return this.prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });
  }
}
```

### src/company-totals/company-totals.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { CompanyTotalsRepository } from './company-totals.repository.js';

@Injectable()
export class CompanyTotalsService {
  constructor(private readonly repo: CompanyTotalsRepository) {}

  async getTotals(companyId: number) {
    return this.repo.findByCompanyId(companyId);
  }
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';
import { PrismaModule } from '../prisma.module.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, CompanyTotalsRepository],
  exports: [OperationsService],
})
export class OperationsModule {}
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async getOperations(
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    const filters = {
      companyId: companyId ? parseInt(companyId, 10) : undefined,
      status: status as any,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page: pageNum,
      pageSize: pageSizeNum,
    };
    return this.operationsService.getOperations(filters);
  }
}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma, OperationProjection } from '@prisma/client';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(params: {
    where?: Prisma.OperationProjectionWhereInput;
    orderBy?: Prisma.OperationProjectionOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<OperationProjection[]> {
    return this.prisma.operationProjection.findMany(params);
  }

  async count(params: {
    where?: Prisma.OperationProjectionWhereInput;
  }): Promise<number> {
    return this.prisma.operationProjection.count(params);
  }

  async upsertProjection(data: Prisma.OperationProjectionCreateInput) {
    return this.prisma.operationProjection.upsert({
      where: { orderId: data.orderId },
      create: data,
      update: data,
    });
  }

  async deleteManyByEventTimestampRange(start: Date, end: Date) {
    return this.prisma.operationProjection.deleteMany({
      where: {
        eventTimestamp: {
          gte: start,
          lte: end,
        },
      },
    });
  }
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { OperationsRepository } from './operations.repository.js';
import { PrismaService } from '../prisma.service.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import { Prisma } from '@prisma/client';

export interface OperationFilters {
  companyId?: number;
  status?: Prisma.OrderStatus;
  startDate?: Date;
  endDate?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly opsRepo: OperationsRepository,
    private readonly totalsRepo: CompanyTotalsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getOperations(filters: OperationFilters) {
    const { page, pageSize } = filters;
    const skip = (page - 1) * pageSize;
    const where: Prisma.OperationProjectionWhereInput = {
      ...(filters.companyId !== undefined && { companyId: filters.companyId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.startDate && filters.endDate && {
        eventTimestamp: {
          gte: filters.startDate,
          lte: filters.endDate,
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.opsRepo.findMany({
        where,
        orderBy: { eventTimestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      this.opsRepo.count({ where }),
    ]);

    return {
      total,
      page,
      pageSize,
      items,
    };
  }

  async rederiveWindow(startDate: Date, endDate: Date) {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.operationProjection.deleteMany({
        where: {
          eventTimestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      const orders = await tx.paymentOrder.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          events: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
          worker: true,
        },
      });

      for (const order of orders) {
        const latestEvent = order.events[0];
        await tx.operationProjection.create({
          data: {
            orderId: order.id,
            companyId: order.companyId,
            workerId: order.workerId,
            status: order.status,
            amount: order.amount,
            eventTimestamp: latestEvent ? latestEvent.timestamp : order.createdAt,
          },
        });
      }
    });
  }

  async repairDrift(windowHours = 1) {
    const now = new Date();
    const start = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

    const sourceRows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: {
          gte: start,
        },
      },
      include: {
        events: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        worker: true,
      },
    });

    for (const order of sourceRows) {
      const latestEvent = order.events[0];
      const projected = await this.prisma.operationProjection.findUnique({
        where: { orderId: order.id },
      });

      const desired = {
        orderId: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        status: order.status,
        amount: order.amount,
        eventTimestamp: latestEvent ? latestEvent.timestamp : order.createdAt,
      };

      if (!projected) {
        await this.prisma.operationProjection.create({ data: desired });
        continue;
      }

      const dirty =
        projected.companyId !== desired.companyId ||
        projected.workerId !== desired.workerId ||
        projected.status !== desired.status ||
        projected.amount !== desired.amount ||
        projected.eventTimestamp.getTime() !== desired.eventTimestamp.getTime();

      if (dirty) {
        await this.prisma.operationProjection.update({
          where: { orderId: order.id },
          data: desired,
        });
      }
    }
  }
}
```

### src/payment-order/payment-order.module.ts
```ts
import { Module } from '@nestjs/common';
import { PaymentOrderService } from './payment-order.service.js';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { PrismaModule } from '../prisma.module.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';

@Module({
  imports: [PrismaModule],
  providers: [
    PaymentOrderService,
    PaymentOrderRepository,
    OperationsRepository,
    CompanyTotalsRepository,
  ],
  exports: [PaymentOrderService],
})
export class PaymentOrderModule {}
```

### src/payment-order/payment-order.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { PaymentOrder } from '@prisma/client';

@Injectable()
export class PaymentOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { id } });
  }
}
```

### src/payment-order/payment-order.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma, OrderStatus } from '@prisma/client';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import type { Decimal } from '@prisma/client/runtime';

@Injectable()
export class PaymentOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderRepo: PaymentOrderRepository,
    private readonly opsRepo: OperationsRepository,
    private readonly totalsRepo: CompanyTotalsRepository,
  ) {}

  async createOrder(data: {
    companyId: number;
    workerId?: number;
    amount: Decimal;
  }) {
    return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.paymentOrder.create({
        data: {
          companyId: data.companyId,
          workerId: data.workerId,
          amount: data.amount,
          status: OrderStatus.PENDING,
        },
      });

      await tx.operationProjection.create({
        data: {
          orderId: order.id,
          companyId: order.companyId,
          workerId: order.workerId,
          status: order.status,
          amount: order.amount,
          eventTimestamp: order.createdAt,
        },
      });

      return order;
    });
  }

  async approveOrder(orderId: number) {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: OrderStatus.APPROVED },
      });

      const event = await tx.event.create({
        data: {
          orderId,
          type: 'APPROVED',
        },
      });

      await tx.operationProjection.update({
        where: { orderId },
        data: {
          status: order.status,
          eventTimestamp: event.timestamp,
        },
      });

      await tx.companyFinancialTotal.upsert({
        where: { companyId: order.companyId },
        create: {
          companyId: order.companyId,
          totalAmount: order.amount,
          approvedAmount: order.amount,
        },
        update: {
          totalAmount: {
            increment: order.amount,
          },
          approvedAmount: {
            increment: order.amount,
          },
        },
      });
    });
  }
}
```

### src/prisma.module.ts
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

### src/scheduler/repair.scheduler.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OperationsService } from '../operations/operations.service.js';

@Injectable()
export class RepairScheduler {
  private readonly logger = new Logger(RepairScheduler.name);
  constructor(private readonly opsService: OperationsService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    this.logger.log('Running drift‑repair job');
    try {
      await this.opsService.repairDrift(1);
      this.logger.log('Drift‑repair job completed');
    } catch (err) {
      this.logger.error('Drift‑repair job failed', err);
    }
  }
}
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

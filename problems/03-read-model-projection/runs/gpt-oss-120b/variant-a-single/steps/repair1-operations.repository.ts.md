# repair1-operations.repository.ts

## reasoning

```
We need to create repository file with proper imports matching other files. Likely missing DTOs. Assume simple implementation using Prisma client. Provide placeholder types. We'll import PrismaService from '../../prisma/prisma.service' maybe. Since unknown, we add assumptions.

Create class OperationsRepository with methods used by service. We need to infer from errors: repository imports pagination.dto and operations.service (circular). Probably not needed. We'll just implement repository with Prisma client methods: getOperations, updateTotals, etc. Provide minimal compile.

Add assumptions comments.
```

## reply

```ts
// src/operations/operations.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

// ASSUMPTION: The project provides a PrismaClient instance via dependency injection
// named `prisma`. If a dedicated PrismaService exists, replace the constructor
// injection accordingly.
@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // READ: fetch paginated operations for the dashboard
  // -------------------------------------------------------------------------
  async getOperations(params: {
    companyId: number;
    status?: string;
    from?: Date;
    to?: Date;
    skip: number;
    take: number;
  }) {
    const { companyId, status, from, to, skip, take } = params;

    const where: Prisma.OperationWhereInput = {
      companyId,
      ...(status && { status }),
      ...(from && { createdAt: { gte: from } }),
      ...(to && { createdAt: { lte: to } }),
    };

    return this.prisma.operation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        paymentOrder: true,
        event: true,
        worker: true,
      },
    });
  }

  // -------------------------------------------------------------------------
  // WRITE: update financial totals for a company (used by hooks & drift repair)
  // -------------------------------------------------------------------------
  async upsertCompanyTotals(
    companyId: number,
    totals: {
      totalAmount: Prisma.Decimal;
      totalCount: number;
    },
  ) {
    return this.prisma.companyTotals.upsert({
      where: { companyId },
      create: {
        companyId,
        totalAmount: totals.totalAmount,
        totalCount: totals.totalCount,
      },
      update: {
        totalAmount: totals.totalAmount,
        totalCount: totals.totalCount,
      },
    });
  }

  // -------------------------------------------------------------------------
  // READ: get current totals for a company (used by read‑your‑own‑writes test)
  // -------------------------------------------------------------------------
  async getCompanyTotals(companyId: number) {
    return this.prisma.companyTotals.findUnique({
      where: { companyId },
    });
  }

  // -------------------------------------------------------------------------
  // RE‑DERIVATION: recompute totals for a date window (used by re‑derivation svc)
  // -------------------------------------------------------------------------
  async recomputeTotalsForWindow(params: {
    from: Date;
    to: Date;
  }) {
    // Aggregate over the operation view (or the underlying tables) to produce
    // totals per company. The exact shape of the source tables is unknown, so
    // we assume an `operation` table with `companyId` and `amount` columns.
    const { from, to } = params;

    const aggregates = await this.prisma.operation.groupBy({
      by: ['companyId'],
      where: {
        createdAt: {
          gte: from,
          lte: to,
        },
      },
      _sum: {
        amount: true,
      },
      _count: {
        _all: true,
      },
    });

    // Upsert each company's totals
    await Promise.all(
      aggregates.map((agg) =>
        this.upsertCompanyTotals(agg.companyId, {
          totalAmount: agg._sum.amount ?? new Prisma.Decimal(0),
          totalCount: agg._count._all,
        }),
      ),
    );

    return aggregates;
  }
}
```

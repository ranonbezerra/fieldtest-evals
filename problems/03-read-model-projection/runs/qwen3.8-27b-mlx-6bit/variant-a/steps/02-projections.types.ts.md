# 02-projections.types.ts

## reasoning

```
We need answer with one fenced code block only. Need implement src/projections/projections.types.ts exactly per plan.

We need parse plan. It says shared types (`src/projections/projections.types.ts`) includes:
export type OrderStatus = 'pending' | 'approved' | 'rejected';

export interface CreateOrderInput {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

export interface OperationRow {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventTitle: string;
  eventLocation: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
}

export interface OperationQueryParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;        // 1-based
  pageSize: number;    // default 20, max 100
}

export interface OperationPage {
  items: OperationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompanyTotals {
  companyId: string;
  approvedTotalCents: bigint;
  rejectedTotalCents: bigint;
  pendingCount: number;
}

export interface DriftReport {
  windowStart: Date;
  windowEnd: Date;
  rowsCorrected: number;
  totalsCorrected: boolean;
}

Need consider strict TS, ESM. Should include comments? Can include plan comments but not necessary. The file only types. Need maybe import? No. Could need total in OperationPage number. amountCents is number but totals BigInt. Source prisma uses Int for amounts, BigInt for totals. OK.

Need ensure no extra exports not named by plan. Plan names those exports exactly. Do we need export interface for adjustTotals delta? Plan in ProjectionsRepository has method adjustTotals(companyId: string, delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number }): Promise<void>; This delta type is inline in repository signature, not necessarily shared types. The file's specified content in plan only lists these interfaces. It says implement exactly what plan specifies for this file. Do not add export not named. Could there be need to export DeltaTotals? The plan doesn't list it in shared types. Don't add.

Need consider status enum from Prisma? Plan says type OrderStatus. Good.

Should include all in one file. Fenced block only. Need no explanation. Ensure code valid TypeScript. Could include comments? It's fine but keep concise. Need maybe semicolons. Use export type and interface.

Double-check if OperationQueryParams pageSize comment default max but type no optional. It has page: number, pageSize: number. OK.

Need maybe from/to as Date not string; controller passes Date after parsing. Good.

Potential issue: In strict, bigint is OK. If target ES? likely fine. Could need `bigint` not `BigInt`. Good.

Need ensure no default export. Good.

Final:
```ts
export type OrderStatus = 'pending' | 'approved' | 'rejected';
...
```

Need maybe order: exactly as plan. Use blank lines.

One subtlety: Plan says `OperationRow` createdAt: Date. But Prisma model has updated_at not in OperationRow. Fine.

Another subtlety: DriftReport rowsCorrected number, totalsCorrected boolean. Good.

Need no assumptions because all present. Final only fenced.
```

## reply

```ts
export type OrderStatus = 'pending' | 'approved' | 'rejected';

export interface CreateOrderInput {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

export interface OperationRow {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventTitle: string;
  eventLocation: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
}

export interface OperationQueryParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompanyTotals {
  companyId: string;
  approvedTotalCents: bigint;
  rejectedTotalCents: bigint;
  pendingCount: number;
}

export interface DriftReport {
  windowStart: Date;
  windowEnd: Date;
  rowsCorrected: number;
  totalsCorrected: boolean;
}
```

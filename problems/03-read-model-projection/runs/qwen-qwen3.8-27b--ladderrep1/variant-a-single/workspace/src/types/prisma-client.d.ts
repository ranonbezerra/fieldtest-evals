declare module '@prisma/client' {
  export type OrderStatus = 'pending' | 'approved' | 'disputed' | 'cancelled';

  export interface Company {
    id: string;
    name: string;
    createdAt: Date;
  }

  export interface Worker {
    id: string;
    name: string;
    companyId: string;
    createdAt: Date;
  }

  export interface PaymentOrder {
    id: string;
    companyId: string;
    workerId: string;
    amountCents: number;
    currency: string;
    status: OrderStatus;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface Event {
    id: string;
    paymentOrderId: string;
    eventType: string;
    note: string | null;
    occurredAt: Date;
  }

  export interface OperationRow {
    id: string;
    paymentOrderId: string;
    companyId: string;
    status: OrderStatus;
    workerName: string;
    amountCents: number;
    currency: string;
    latestEventType: string | null;
    latestEventAt: Date | null;
    latestEventId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface CompanyFinancialTotals {
    companyId: string;
    pendingAmountCents: number;
    pendingCount: number;
    approvedAmountCents: number;
    approvedCount: number;
    disputedAmountCents: number;
    disputedCount: number;
    cancelledAmountCents: number;
    cancelledCount: number;
    updatedAt: Date;
  }

  export interface CompanyFinancialTotalsCreateInput {
    companyId: string;
    updatedAt: Date;
    pendingAmountCents?: number;
    pendingCount?: number;
    approvedAmountCents?: number;
    approvedCount?: number;
    disputedAmountCents?: number;
    disputedCount?: number;
    cancelledAmountCents?: number;
    cancelledCount?: number;
  }

  export interface CompanyFinancialTotalsUpdateInput {
    updatedAt?: Date;
    pendingAmountCents?: number | { increment: number; decrement: number };
    pendingCount?: number | { increment: number; decrement: number };
    approvedAmountCents?: number | { increment: number; decrement: number };
    approvedCount?: number | { increment: number; decrement: number };
    disputedAmountCents?: number | { increment: number; decrement: number };
    disputedCount?: number | { increment: number; decrement: number };
    cancelledAmountCents?: number | { increment: number; decrement: number };
    cancelledCount?: number | { increment: number; decrement: number };
  }

  export namespace Prisma {
    export type TransactionClient = PrismaClient;

    export interface DateTimeFilter {
      equals?: Date;
      in?: Date[];
      notIn?: Date[];
      lt?: Date;
      lte?: Date;
      gt?: Date;
      gte?: Date;
      not?: Date;
    }

    export interface OperationRowWhereInput {
      id?: string;
      paymentOrderId?: string;
      companyId?: string;
      status?: OrderStatus;
      createdAt?: DateTimeFilter;
      updatedAt?: DateTimeFilter;
      AND?: OperationRowWhereInput[];
      OR?: OperationRowWhereInput[];
      NOT?: OperationRowWhereInput | OperationRowWhereInput[];
    }
  }

  interface FindUniqueArgs<TWhere> {
    where: TWhere;
    select?: Record<string, boolean>;
    include?: Record<string, boolean | Record<string, boolean>>;
  }

  interface FindManyArgs<TWhere> {
    where?: TWhere;
    orderBy?: Array<Record<string, 'asc' | 'desc'>>;
    skip?: number;
    take?: number;
    select?: Record<string, boolean>;
    include?: Record<string, boolean | Record<string, boolean>>;
  }

  interface CountArgs<TWhere> {
    where?: TWhere;
    select?: Record<string, boolean>;
  }

  interface CreateArgs<TData> {
    data: TData;
  }

  interface UpdateArgs<TWhere, TData> {
    where: TWhere;
    data: TData;
  }

  interface UpdateManyArgs<TWhere, TData> {
    where: TWhere;
    data: TData;
  }

  interface UpsertArgs<TWhere, TCreate, TUpdate> {
    where: TWhere;
    create: TCreate;
    update: TUpdate;
  }

  export class PrismaClient {
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
    $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;

    company: {
      findUnique(args: FindUniqueArgs<{ id: string }>): Promise<Company | null>;
      findMany(args?: FindManyArgs<Record<string, unknown>>): Promise<Company[]>;
      count(args?: CountArgs<Record<string, unknown>>): Promise<number>;
      create(args: CreateArgs<Record<string, unknown>>): Promise<Company>;
      update(args: UpdateArgs<{ id: string }, Record<string, unknown>>): Promise<Company>;
    };

    worker: {
      findUnique(args: FindUniqueArgs<{ id: string }>): Promise<Worker | null>;
      findMany(args?: FindManyArgs<Record<string, unknown>>): Promise<Worker[]>;
      count(args?: CountArgs<Record<string, unknown>>): Promise<number>;
      create(args: CreateArgs<Record<string, unknown>>): Promise<Worker>;
      update(args: UpdateArgs<{ id: string }, Record<string, unknown>>): Promise<Worker>;
    };

    paymentOrder: {
      findUnique(args: FindUniqueArgs<{ id: string }>): Promise<PaymentOrder | null>;
      findMany(args?: FindManyArgs<Record<string, unknown>>): Promise<PaymentOrder[]>;
      count(args?: CountArgs<Record<string, unknown>>): Promise<number>;
      create(args: CreateArgs<Record<string, unknown>>): Promise<PaymentOrder>;
      update(args: UpdateArgs<{ id: string }, Record<string, unknown>>): Promise<PaymentOrder>;
      updateMany(args: UpdateManyArgs<Record<string, unknown>, Record<string, unknown>>): Promise<{ count: number }>;
    };

    event: {
      findUnique(args: FindUniqueArgs<{ id: string }>): Promise<Event | null>;
      findMany(args?: FindManyArgs<Record<string, unknown>>): Promise<Event[]>;
      count(args?: CountArgs<Record<string, unknown>>): Promise<number>;
      create(args: CreateArgs<Record<string, unknown>>): Promise<Event>;
      update(args: UpdateArgs<{ id: string }, Record<string, unknown>>): Promise<Event>;
    };

    operationRow: {
      findUnique(args: FindUniqueArgs<{ id: string } | { paymentOrderId: string }>): Promise<OperationRow | null>;
      findMany(args?: FindManyArgs<Prisma.OperationRowWhereInput>): Promise<OperationRow[]>;
      count(args?: CountArgs<Prisma.OperationRowWhereInput>): Promise<number>;
      create(args: CreateArgs<Record<string, unknown>>): Promise<OperationRow>;
      update(args: UpdateArgs<{ id: string }, Record<string, unknown>>): Promise<OperationRow>;
    };

    companyFinancialTotals: {
      findUnique(args: FindUniqueArgs<{ companyId: string }>): Promise<CompanyFinancialTotals | null>;
      findMany(args?: FindManyArgs<Record<string, unknown>>): Promise<CompanyFinancialTotals[]>;
      count(args?: CountArgs<Record<string, unknown>>): Promise<number>;
      create(args: CreateArgs<CompanyFinancialTotalsCreateInput>): Promise<CompanyFinancialTotals>;
      update(args: UpdateArgs<{ companyId: string }, CompanyFinancialTotalsUpdateInput>): Promise<CompanyFinancialTotals>;
      upsert(
        args: UpsertArgs<{ companyId: string }, CompanyFinancialTotalsCreateInput, CompanyFinancialTotalsUpdateInput>,
      ): Promise<CompanyFinancialTotals>;
    };
  }
}

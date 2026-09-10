declare module '@prisma/client' {
  export class PrismaClientKnownRequestError extends Error {
    code: string;
    meta?: Record<string, unknown>;
  }

  export namespace Prisma {
    export { PrismaClientKnownRequestError };

    export interface TransactionClient {
      account: {
        updateMany(args: any): Promise<{ count: number }>;
        findUnique(args: any): Promise<any | null>;
        update(args: any): Promise<any>;
      };
      payout: {
        create(args: any): Promise<any>;
        findFirst(args: any): Promise<any | null>;
        findUnique(args: any): Promise<any | null>;
        update(args: any): Promise<any>;
        updateMany(args: any): Promise<{ count: number }>;
      };
      outboxMessage: {
        create(args: any): Promise<any>;
        update(args: any): Promise<any>;
      };
      processedMessage: {
        upsert(args: any): Promise<any>;
      };
      ledgerEntry: {
        create(args: any): Promise<any>;
        findMany(args: any): Promise<
          Array<{
            bucket: string;
            direction: string;
            amount: bigint;
            sequence: number;
            payoutId: string;
            accountId: string;
            outboxId: string | null;
            createdAt: Date;
          }>
        >;
      };
    }
  }

  export class PrismaClient {
    $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
    $queryRaw<T>(sql: TemplateStringsArray, ...values: unknown[]): Promise<T>;
    account: {
      updateMany(args: any): Promise<{ count: number }>;
      findUnique(args: any): Promise<any | null>;
      update(args: any): Promise<any>;
    };
    payout: {
      create(args: any): Promise<any>;
      findFirst(args: any): Promise<any | null>;
      findUnique(args: any): Promise<any | null>;
      update(args: any): Promise<any>;
      updateMany(args: any): Promise<{ count: number }>;
    };
    outboxMessage: {
      create(args: any): Promise<any>;
      update(args: any): Promise<any>;
    };
    processedMessage: {
      upsert(args: any): Promise<any>;
    };
    ledgerEntry: {
      create(args: any): Promise<any>;
      findMany(args: any): Promise<
        Array<{
          bucket: string;
          direction: string;
          amount: bigint;
          sequence: number;
          payoutId: string;
          accountId: string;
          outboxId: string | null;
          createdAt: Date;
        }>
      >;
    };
  }
}

declare module '@nestjs/testing' {
  export interface TestingModule {
    useGlobalFilters(...filters: unknown[]): void;
    get<T = any>(type: new (...args: any[]) => T): T;
    createNestApplication(): {
      useGlobalFilters(...filters: unknown[]): void;
      init(): Promise<void>;
      getHttpServer(): any;
      close(): Promise<void>;
    };
  }

  export interface TestingModuleBuilder {
    overrideProvider(token: unknown): TestingModuleBuilder;
    useValue(value: unknown): TestingModuleBuilder;
    compile(): Promise<TestingModule>;
  }

  export const Test: {
    createTestingModule(options: {
      controllers?: (new (...args: any[]) => any)[];
      providers?: unknown[];
      imports?: unknown[];
    }): TestingModuleBuilder;
  };
}

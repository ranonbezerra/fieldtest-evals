declare module 'pg' {
  export class Pool {
    connect(): Promise<PoolClient>;
  }
  export class PoolClient {
    query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
    release(): void;
  }
}

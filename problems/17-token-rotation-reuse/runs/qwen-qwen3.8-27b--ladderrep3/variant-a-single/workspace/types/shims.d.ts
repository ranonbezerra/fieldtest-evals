declare module 'express' {
  export interface Request {
    headers: Record<string, string | string[] | undefined>;
  }
  export interface Response {
    status(code: number): Response;
    json(body: unknown): void;
    setHeader(name: string, value: string | number): void;
  }
}

declare module '@nestjs/testing' {
  export interface TestingModule {
    createNestApplication(): import('@nestjs/common').INestApplication;
  }
  export interface TestingModuleBuilder {
    overrideProvider(token: unknown): TestingModuleBuilder;
    useValue(value: unknown): TestingModuleBuilder;
    compile(): Promise<TestingModule>;
  }
  export const Test: {
    createTestingModule(options: Record<string, unknown>): TestingModuleBuilder;
  };
}

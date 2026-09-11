declare module 'express' {
  export interface Request {
    headers: Record<string, string | string[] | undefined>;
    [key: string]: any;
  }

  export interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
    setHeader(name: string, value: string | number | string[]): Response;
    [key: string]: any;
  }
}

declare module '@nestjs/testing' {
  import { INestApplication } from '@nestjs/common';

  export interface TestingModule {
    createNestApplication(): INestApplication;
    get<T = any>(token: any): T;
  }

  export interface TestingModuleBuilder {
    overrideProvider(token: any): TestingModuleBuilder;
    useValue(value: any): TestingModuleBuilder;
    compile(): Promise<TestingModule>;
  }

  export const Test: {
    createTestingModule(moduleDefinition: Record<string, unknown>): TestingModuleBuilder;
  };
}

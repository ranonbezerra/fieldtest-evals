declare module '@nestjs/testing' {
  import { INestApplication } from '@nestjs/common';

  export class Test {
    static createTestingModule(options: {
      imports?: any[];
      controllers?: any[];
      providers?: any[];
    }): TestModuleBuilder;
  }

  export interface TestModuleBuilder {
    overrideProvider(token: any): { useValue(value: any): TestModuleBuilder };
    useValue(value: any): TestModuleBuilder;
    compile(): Promise<TestingModule>;
  }

  export interface TestingModule {
    createNestApplication(options?: any): Promise<INestApplication>;
  }
}

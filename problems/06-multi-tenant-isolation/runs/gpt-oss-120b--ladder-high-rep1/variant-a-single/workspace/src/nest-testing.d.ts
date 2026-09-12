declare module '@nestjs/testing' {
  export interface TestingModule {
    createNestApplication(): any;
    get<T = any>(typeOrToken: any): T;
  }

  export interface TestingModuleBuilder {
    compile(): Promise<TestingModule>;
    setLogger(logger: any): this;
    useLogger(logger: any): this;
    overrideProvider(token: any): any;
    overrideGuard(token: any): any;
    overrideInterceptor(token: any): any;
    overrideFilter(token: any): any;
    overridePipe(token: any): any;
  }

  export const Test: {
    createTestingModule(metadata: any): TestingModuleBuilder;
  };
}

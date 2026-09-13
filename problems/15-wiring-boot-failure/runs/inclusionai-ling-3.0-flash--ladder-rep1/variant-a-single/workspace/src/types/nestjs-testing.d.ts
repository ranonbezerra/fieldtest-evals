declare module '@nestjs/testing' {
  export class Test {
    static createTestingModule(options: {
      imports?: any[];
      providers?: any[];
      controllers?: any[];
      exports?: any[];
    }): TestBuilder;
  }

  export interface TestBuilder {
    compile(): Promise<ModuleRef>;
  }

  export interface ModuleRef {
    get<T>(token: string): T;
  }
}

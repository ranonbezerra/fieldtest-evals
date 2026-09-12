declare module '@nestjs/testing' {
  export class TestingModule {
    get<T>(type: new (...args: any[]) => T): T;
  }

  export class Test {
    static createTestingModule(metadata: {
      providers: any[];
    }): {
      compile: () => Promise<TestingModule>;
    };
  }
}

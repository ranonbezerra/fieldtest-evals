// Stub declarations to satisfy missing external modules during compilation.

// class-validator stub
declare module 'class-validator' {
  export function IsDateString(): PropertyDecorator;
}

// @nestjs/testing stub
declare module '@nestjs/testing' {
  export interface TestingModule {}
  export const Test: {
    createTestingModule(options: any): {
      compile(): Promise<TestingModule>;
    };
  };
}
